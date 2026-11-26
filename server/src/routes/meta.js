import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../utils/errorCodes.js';
import { verifyMetaSignature } from '../services/hmac.js';
import { encryptToken, decryptToken } from '../services/crypto.js';
import { testMetaConnection, getGraphToken, fetchLeadsByForm } from '../services/metaGraph.js';
import { upsertLead, autoAssignLead, parseMetaFields } from '../services/leadService.js';
import { logActivity } from '../services/activity.js';
import { createNotification } from '../services/notification.js';
import { logIntegrationEvent } from '../services/integrationLog.js';
import { maskSecret } from '../services/crypto.js';
import { processWebhookQueue, getWebhookQueueStatus, retryFailedQueueItem, getDeadLetters, cleanupProcessedQueue } from '../services/queue.js';

const router = Router();

// ----- PUBLIC WEBHOOK ROUTES -----

// GET /api/meta/webhook - verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode !== 'subscribe') {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  const db = getDb();
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('m_verify_token');
  const expectedToken = setting?.value ? safeGetSetting('m_verify_token') : process.env.META_VERIFY_TOKEN;

  if (!token || token !== expectedToken) {
    return res.status(403).json({ error: 'Verification token mismatch' });
  }

  res.set('Content-Type', 'text/plain');
  res.send(challenge || '');
});

function safeGetSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value, is_secret FROM settings WHERE key = ?').get(key);
  if (!row) return process.env[key] || null;
  if (row.is_secret) {
    try {
      return decryptToken(row.value);
    } catch {
      return row.value;
    }
  }
  return row.value;
}

// POST /api/meta/webhook - receive lead notifications
router.post('/webhook', async (req, res) => {
  // IMPORTANT: Must respond within 20s. We persist and return immediately.

  const db = getDb();
  const signature = req.headers['x-hub-signature-256'] || req.headers['X-Hub-Signature-256'];
  const appSecret = safeGetSetting('m_app_secret') || process.env.META_APP_SECRET;

  if (!appSecret) {
    console.error('[WEBHOOK] No app secret configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Verify HMAC-SHA256 signature using timing-safe comparison
  if (!verifyMetaSignature(appSecret, req.rawBody || Buffer.from(''), signature)) {
    console.warn('[WEBHOOK] Invalid signature');
    await logIntegrationEvent({
      integrationId: null,
      level: 'warn',
      component: 'webhook',
      message: 'webhook_signature_failed',
      details: JSON.stringify({ signature: maskSecret(signature || '') }),
    });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Persist each leadgen event to SQLite for replay protection and durable processing
  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;
        const value = change.value || {};
        if (!value.leadgen_id) continue;

        const eventId = value.event_id || `${value.leadgen_id}-${Date.now()}`;
        const now = new Date().toISOString();

        // Insert into meta_webhook_events with unique event_id (replay protection)
        let eventInserted = false;
        try {
          db.prepare(
            `INSERT INTO meta_webhook_events
               (event_id, leadgen_id, form_id, page_id, ad_id, adset_id, campaign_id,
                object_type, object_id, raw_payload, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'leadgen', ?, ?, 'received', datetime('now'))`
          ).run(
            eventId,
            value.leadgen_id,
            value.form_id || '',
            value.page_id || '',
            value.ad_id || value.adgroup_id || '',
            value.adset_id || '',
            value.campaign_id || '',
            value.id || value.leadgen_id,
            JSON.stringify(value)
          );
          eventInserted = true;
        } catch (err) {
          // Duplicate event_id - replay protection, skip
          if (err.message.includes('UNIQUE constraint failed')) {
            console.log(`[WEBHOOK] Duplicate event ${eventId} skipped`);
            continue;
          }
          throw err;
        }

        // Enqueue into SQLite-backed processing queue
        if (eventInserted) {
          db.prepare(
            `INSERT INTO meta_webhook_queue
               (leadgen_id, form_id, page_id, ad_id, adset_id, campaign_id, event_id,
                raw_payload, status, retry_count, max_retries, created_at, next_retry_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, datetime('now'), datetime('now'))`
          ).run(
            value.leadgen_id,
            value.form_id || '',
            value.page_id || '',
            value.ad_id || value.adgroup_id || '',
            value.adset_id || '',
            value.campaign_id || '',
            eventId,
            JSON.stringify(value)
          );
        }
      }
    }
  } catch (err) {
    console.error('[WEBHOOK] Error persisting payload:', err.message);
    await logIntegrationEvent({
      integrationId: null,
      level: 'error',
      component: 'webhook',
      message: 'webhook_persist_failed',
      details: err.message,
    });
    return res.status(500).json({ error: 'Failed to persist webhook event' });
  }

  // Kick off async queue processing (does not block the 200 response)
  processWebhookQueue().catch((err) => {
    console.error('[WEBHOOK] Queue processor error:', err.message);
  });

  // Respond immediately (Meta requires <20s)
  res.status(200).send('EVENT_RECEIVED');
});

// ----- PROTECTED ROUTES -----

// GET /api/meta/settings - get settings (masked)
router.get('/settings', authMiddleware, requireRole('admin'), (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value, is_secret, updated_at FROM settings').all();
    const result = {};
    for (const row of rows) {
      if (row.is_secret && row.value) {
        result[row.key] = '***';
      } else {
        result[row.key] = row.value;
      }
    }
    res.json({ settings: result });
  } catch (err) {
    next(err);
  }
});

// PUT /api/meta/settings - update settings
router.put('/settings', authMiddleware, requireRole('admin'), (req, res, next) => {
  try {
    const schema = z.object({
      app_id: z.string().optional(),
      app_secret: z.string().optional(),
      page_access_token: z.string().optional(),
      verify_token: z.string().optional(),
      default_assignee_email: z.string().email().optional(),
    });

    const data = schema.parse(req.body);
    const db = getDb();

    const mapping = {
      app_id: 'm_app_id',
      app_secret: 'm_app_secret',
      page_access_token: 'm_page_access_token',
      verify_token: 'm_verify_token',
      default_assignee_email: 'default_assignee',
    };

    const upsert = db.prepare(
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
    );

    for (const [field, key] of Object.entries(mapping)) {
      if (data[field] !== undefined && data[field] !== '***') {
        const isSecret = ['app_secret', 'page_access_token', 'verify_token'].includes(field) ? 1 : 0;
        let val = data[field];
        if (isSecret && val) {
          val = encryptToken(val);
        }
        upsert.run(key, val, isSecret);
      }
    }

    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/meta/test - test connection
router.post('/test', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await testMetaConnection();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/meta/sync - manual sync
router.post('/sync', authMiddleware, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const schema = z.object({
      form_id: z.string().min(1),
      limit: z.number().int().min(1).max(500).optional().default(100),
    });

    const { form_id, limit } = schema.parse(req.body);
    const token = getGraphToken();
    if (!token) throw new AppError(400, 'Meta token not configured');

    const leads = await fetchLeadsByForm(form_id, token, limit);
    let inserted = 0, merged = 0, updated = 0;

    for (const lead of leads) {
      const result = await upsertLead({
        ...lead,
        updated_by: req.user.id,
      });
      if (result.action === 'inserted') inserted++;
      else if (result.action === 'merged') merged++;
      else updated++;
    }

    res.json({ synced: leads.length, inserted, merged, updated });
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/webhook/queue/status - monitoring
router.get('/webhook/queue/status', authMiddleware, requireRole('admin', 'manager'), (req, res) => {
  res.json(getWebhookQueueStatus());
});

// POST /api/meta/webhook/queue/retry/:eventId - retry a failed item
router.post('/webhook/queue/retry/:eventId', authMiddleware, requireRole('admin'), (req, res, next) => {
  try {
    const result = retryFailedQueueItem(req.params.eventId);
    // Kick off processing
    processWebhookQueue().catch((err) => console.error('[WEBHOOK] Retry processor error:', err.message));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/webhook/queue/dead-letters - list dead letter items
router.get('/webhook/queue/dead-letters', authMiddleware, requireRole('admin'), (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  res.json({ deadLetters: getDeadLetters(limit) });
});

// POST /api/meta/webhook/queue/cleanup - cleanup old processed items
router.post('/webhook/queue/cleanup', authMiddleware, requireRole('admin'), (req, res) => {
  const daysOld = parseInt(req.query.days || '30', 10);
  res.json(cleanupProcessedQueue(daysOld));
});

export default router;
