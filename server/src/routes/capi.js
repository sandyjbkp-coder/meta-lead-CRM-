// Conversions API routes: send events, queue, monitoring, test
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../utils/errorCodes.js';
import {
  sendCapiEvent,
  queueCapiEvent,
  processCapiQueue,
  getCapiDeliveryStatus,
  getCapiDeadLetters,
  retryCapiEvent,
  checkCapiHealth,
  sendTestEvent,
  buildUserData,
  sha256Hash,
} from '../services/capi.js';

const router = Router();

// ----- PROTECTED CAPI ROUTES -----

// POST /api/meta/capi/event - send a conversion event
router.post('/capi/event', authMiddleware, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const schema = z.object({
      event_name: z.string().min(1),
      event_time: z.number().int().optional(),
      event_id: z.string().min(1).optional(),
      action_source: z.enum(['website', 'app', 'offline', 'phone_call', 'chat', 'system', 'physical_store', 'other']).optional(),
      event_source_url: z.string().url().optional(),
      user_data: z.object({
        email: z.string().email().optional(),
        phone: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        external_id: z.string().optional(),
        fbc: z.string().optional(),
        fbp: z.string().optional(),
        client_ip_address: z.string().optional(),
        user_agent: z.string().optional(),
      }).optional(),
      custom_data: z.record(z.any()).optional(),
    });

    const data = schema.parse(req.body);

    const eventId = data.event_id || `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Attempt direct delivery AND queue for reliability
    try {
      const result = await sendCapiEvent({
        ...data,
        event_id: eventId,
      });
      res.json({ delivered: true, ...result });
    } catch (err) {
      // Fall back to queue
      await queueCapiEvent({
        ...data,
        event_id: eventId,
      });
      res.status(202).json({ queued: true, eventId, reason: err.message });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/meta/capi/queue - queue an event for later delivery
router.post('/capi/queue', authMiddleware, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const schema = z.object({
      event_name: z.string().min(1),
      event_time: z.number().int().optional(),
      event_id: z.string().min(1).optional(),
      action_source: z.enum(['website', 'app', 'offline', 'phone_call', 'chat', 'system', 'physical_store', 'other']).optional(),
      user_data: z.object({
        email: z.string().email().optional(),
        phone: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        country: z.string().optional(),
        external_id: z.string().optional(),
        fbc: z.string().optional(),
        fbp: z.string().optional(),
        client_ip_address: z.string().optional(),
        user_agent: z.string().optional(),
      }).optional(),
      custom_data: z.record(z.any()).optional(),
    });

    const data = schema.parse(req.body);
    const result = await queueCapiEvent(data);
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/meta/capi/process - process the CAPI queue
router.post('/capi/process', authMiddleware, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await processCapiQueue();
    res.json({ processed: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/capi/status - delivery status and health
router.get('/capi/status', authMiddleware, async (req, res) => {
  const health = checkCapiHealth();
  const deliveryStatus = getCapiDeliveryStatus(50);
  const deadLetters = getCapiDeadLetters(20);

  res.json({
    health,
    recentDeliveries: deliveryStatus,
    deadLetters,
  });
});

// POST /api/meta/capi/test-event - send a test event using test_event_code
router.post('/capi/test-event', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const schema = z.object({
      event_name: z.string().min(1).optional().default('PageView'),
    });

    const { event_name } = schema.parse(req.body);
    const result = await sendTestEvent(event_name);
    res.json({ testEventSent: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/meta/capi/retry/:eventId - retry a failed CAPI event
router.post('/capi/retry/:eventId', authMiddleware, requireRole('admin'), (req, res, next) => {
  try {
    const result = retryCapiEvent(req.params.eventId);
    processCapiQueue().catch((err) => console.error('[CAPI] Retry processor error:', err.message));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/meta/capi/dead-letters - list CAPI dead letter items
router.get('/capi/dead-letters', authMiddleware, requireRole('admin', 'manager'), (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  res.json({ deadLetters: getCapiDeadLetters(limit) });
});

// Utility: hash a value (client-side helper endpoint)
router.post('/capi/hash', authMiddleware, (req, res) => {
  const { value } = req.body || {};
  if (!value) {
    return res.status(400).json({ error: 'value is required' });
  }
  res.json({ hashed: sha256Hash(value) });
});

export default router;
