// SQLite-backed webhook processing queue with retry policy and dead-letter handling.
// Survives server restarts (unlike the previous in-memory Map).
import { getDb } from '../db/connection.js';
import { getGraphToken, fetchLeadById } from './metaGraph.js';
import { upsertLead, autoAssignLead } from './leadService.js';
import { logActivity } from './activity.js';
import { createNotification } from './notification.js';
import { logIntegrationEvent } from './integrationLog.js';
import { maskSecret } from './crypto.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
let processorRunning = false;

/**
 * Process all pending webhook queue items from SQLite.
 * This should be called after webhook persistence and periodically.
 */
export async function processWebhookQueue() {
  if (processorRunning) return;
  processorRunning = true;

  try {
    const db = getDb();
    const now = new Date().toISOString();

    // Claim pending items whose next_retry_at <= now
    const items = db.prepare(
      `SELECT * FROM meta_webhook_queue
       WHERE status = 'pending' AND next_retry_at <= ?
       ORDER BY created_at ASC
       LIMIT 50`
    ).all(now);

    for (const item of items) {
      // Mark as processing
      db.prepare(
        `UPDATE meta_webhook_queue SET status = 'processing' WHERE id = ?`
      ).run(item.id);

      try {
        await processQueueItem(db, item);
        db.prepare(
          `UPDATE meta_webhook_queue SET status = 'completed', processed_at = datetime('now') WHERE id = ?`
        ).run(item.id);

        await logIntegrationEvent({
          integrationId: null,
          level: 'info',
          component: 'webhook',
          message: 'webhook_queue_item_completed',
          details: JSON.stringify({ leadgen_id: item.leadgen_id, event_id: item.event_id }),
        });
      } catch (err) {
        const retryCount = item.retry_count + 1;
        const errorMsg = err.message;

        if (retryCount < item.max_retries) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount - 1);
          const nextRetry = new Date(Date.now() + delayMs).toISOString();
          db.prepare(
            `UPDATE meta_webhook_queue
               SET status = 'pending', retry_count = ?, next_retry_at = ?, last_error = ?
             WHERE id = ?`
          ).run(retryCount, nextRetry, errorMsg, item.id);

          await logIntegrationEvent({
            integrationId: null,
            level: 'warn',
            component: 'webhook',
            message: 'webhook_queue_item_retry',
            details: JSON.stringify({ leadgen_id: item.leadgen_id, retry: retryCount, error: errorMsg }),
          });
        } else {
          // Dead letter: move to meta_sync_errors and mark failed
          db.prepare(
            `INSERT INTO meta_sync_errors (leadgen_id, form_id, error, retry_count, payload, created_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))`
          ).run(item.leadgen_id, item.form_id || '', errorMsg, retryCount, item.raw_payload || '');

          db.prepare(
            `UPDATE meta_webhook_queue SET status = 'failed', last_error = ? WHERE id = ?`
          ).run(errorMsg, item.id);

          // Notify admins
          const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin');
          for (const admin of admins) {
            createNotification(
              admin.id,
              'sync_error',
              'Meta webhook processing failed',
              `Failed to process lead ${item.leadgen_id} after ${item.max_retries} attempts: ${errorMsg}`
            );
          }

          await logIntegrationEvent({
            integrationId: null,
            level: 'error',
            component: 'webhook',
            message: 'webhook_queue_item_dead_letter',
            details: JSON.stringify({ leadgen_id: item.leadgen_id, error: errorMsg }),
          });
        }
      }
    }
  } finally {
    processorRunning = false;
  }
}

/**
 * Process a single webhook queue item: fetch lead from Meta Graph and upsert.
 */
async function processQueueItem(db, item) {
  const token = getGraphToken();
  if (!token) {
    throw new Error('No Meta page access token configured');
  }

  const { lead } = await fetchLeadById(item.leadgen_id, token);

  // Enrich with form metadata
  if (item.form_id) {
    const form = db.prepare('SELECT * FROM meta_lead_forms WHERE form_id = ?').get(item.form_id);
    if (form) {
      lead.meta_form_id = item.form_id;
    }
  }

  // Upsert with deduplication (unique meta_lead_id enforced at DB level)
  const result = await upsertLead({
    ...lead,
    updated_by: null, // system
  });

  // Auto-assign if newly inserted
  if (result.action === 'inserted') {
    const newLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.id);
    const assigneeId = autoAssignLead(newLead);
    if (assigneeId) {
      createNotification(
        assigneeId,
        'new_lead',
        'New lead assigned',
        `New lead "${lead.full_name || 'Unknown'}" from Meta has been assigned to you`
      );
    }
  }

  // Mark webhook event as processed
  db.prepare(
    `UPDATE meta_webhook_events SET processed = 1 WHERE event_id = ?`
  ).run(item.event_id);

  return result;
}

/**
 * Get queue status for monitoring.
 */
export function getWebhookQueueStatus() {
  const db = getDb();
  const pending = db.prepare(
    `SELECT COUNT(*) as c FROM meta_webhook_queue WHERE status = 'pending'`
  ).get().c;
  const processing = db.prepare(
    `SELECT COUNT(*) as c FROM meta_webhook_queue WHERE status = 'processing'`
  ).get().c;
  const completed = db.prepare(
    `SELECT COUNT(*) as c FROM meta_webhook_queue WHERE status = 'completed'`
  ).get().c;
  const failed = db.prepare(
    `SELECT COUNT(*) as c FROM meta_webhook_queue WHERE status = 'failed'`
  ).get().c;
  const deadLetters = db.prepare(
    `SELECT COUNT(*) as c FROM meta_sync_errors`
  ).get().c;

  return {
    pending,
    processing,
    completed,
    failed,
    dead_letters: deadLetters,
    processorRunning,
  };
}

/**
 * Retry a failed queue item by resetting its status.
 */
export function retryFailedQueueItem(eventId) {
  const db = getDb();
  const item = db.prepare(
    `SELECT * FROM meta_webhook_queue WHERE event_id = ? AND status = 'failed'`
  ).get(eventId);

  if (!item) throw new Error('Failed queue item not found');

  db.prepare(
    `UPDATE meta_webhook_queue
       SET status = 'pending', retry_count = 0, next_retry_at = datetime('now'), last_error = null
     WHERE id = ?`
  ).run(item.id);

  return { retried: true, eventId };
}

/**
 * Get dead letter items for review.
 */
export function getDeadLetters(limit = 50) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM meta_sync_errors ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

/**
 * Clear processed items older than N days (retention).
 */
export function cleanupProcessedQueue(daysOld = 30) {
  const db = getDb();
  const info = db.prepare(
    `DELETE FROM meta_webhook_queue
     WHERE status = 'completed' AND processed_at < datetime('now', ? || ' days')`
  ).run(`-${daysOld}`);
  return { deleted: info.changes };
}
