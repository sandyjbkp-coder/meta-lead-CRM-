// Conversions API (CAPI) server-to-server integration for Meta.
// Posts events to Graph API /{pixel_id}/events endpoint.
// Supports deduplication, test_event_code, SHA-256 hashing of user data,
// delivery logs, retry queue, and dead-letter handling.
import { createHash } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { getGraphApiVersion, hasCapiConfig, env } from '../config/env.js';
import { getIntegrationSecrets, getActiveIntegration } from './oauth.js';
import { logIntegrationEvent } from './integrationLog.js';
import { AppError } from '../utils/errorCodes.js';
import { maskSecret } from './crypto.js';

const MAX_EVENT_RETRIES = 3;
const BASE_DELAY_MS = 2000;

/**
 * SHA-256 hash a customer identifier (email, phone, etc.).
 * Meta requires eligible identifiers to be hashed before transmission.
 */
export function sha256Hash(value) {
  if (!value || value.trim() === '') return '';
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Normalize and hash eligible user data fields for CAPI.
 * Never transmits raw personal info - only hashed values.
 */
export function buildUserData(userData = {}) {
  const hashed = {};

  if (userData.email) hashed.em = [sha256Hash(userData.email)];
  if (userData.phone) hashed.ph = [sha256Hash(userData.phone)];
  if (userData.first_name) hashed.fn = [sha256Hash(userData.first_name)];
  if (userData.last_name) hashed.ln = [sha256Hash(userData.last_name)];
  if (userData.city) hashed.ct = [sha256Hash(userData.city)];
  if (userData.state) hashed.st = [sha256Hash(userData.state)];
  if (userData.zip) hashed.zp = [sha256Hash(userData.zip)];
  if (userData.country) hashed.country = [sha256Hash(userData.country)];

  // External IDs are already identifiers, hash them too
  if (userData.external_id) hashed.external_id = [sha256Hash(userData.external_id)];
  if (userData.fbc) hashed.fbc = [userData.fbc]; // fbc is already hashed by Meta SDK
  if (userData.fbp) hashed.fbp = [userData.fbp]; // fbp is already hashed by Meta SDK

  // Client IP and user agent are allowed in raw form for CAPI
  if (userData.client_ip_address) hashed.client_ip_address = userData.client_ip_address;
  if (userData.user_agent) hashed.user_agent = userData.user_agent;

  return hashed;
}

/**
 * Get the active integration's pixel_id and page access token.
 */
function getCapiConfig() {
  const integration = getActiveIntegration();
  if (!integration) return null;

  const secrets = getIntegrationSecrets(integration.id);
  if (!secrets || !secrets.pageAccessToken) return null;

  const pixelId = integration.pixel_id || env.META_PIXEL_ID;
  if (!pixelId) return null;

  return {
    integrationId: integration.id,
    pixelId,
    accessToken: secrets.pageAccessToken,
    apiVersion: integration.graph_api_version || getGraphApiVersion(),
    testEventCode: integration.test_event_code || env.META_TEST_EVENT_CODE,
  };
}

/**
 * Send a single conversion event to Meta CAPI.
 * Endpoint: POST /{pixel_id}/events
 */
export async function sendCapiEvent(eventData) {
  const config = getCapiConfig();
  if (!config) {
    throw new AppError(400, 'CAPI not configured: missing pixel_id or page access token');
  }

  const version = config.apiVersion;
  const url = `https://graph.facebook.com/${version}/${config.pixelId}/events`;

  const payload = {
    data: [
      {
        event_name: eventData.event_name,
        event_time: eventData.event_time || Math.floor(Date.now() / 1000),
        event_id: eventData.event_id,
        action_source: eventData.action_source || 'website',
        event_source_url: eventData.event_source_url || null,
        user_data: buildUserData(eventData.user_data),
        custom_data: eventData.custom_data || {},
      },
    ],
  };

  // Include test_event_code if configured
  if (config.testEventCode) {
    payload.test_event_code = config.testEventCode;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));

  // Log the delivery attempt
  const deliveryStatus = res.ok ? 'delivered' : 'failed';
  const errorMessage = res.ok ? null : body.error?.message || `HTTP ${res.status}`;

  await logCapiDelivery({
    integrationId: config.integrationId,
    eventId: eventData.event_id,
    eventName: eventData.event_name,
    eventTime: eventData.event_time || Math.floor(Date.now() / 1000),
    actionSource: eventData.action_source || 'website',
    deliveryStatus,
    errorMessage,
    payload: JSON.stringify(payload),
    response: JSON.stringify(body),
  });

  if (!res.ok) {
    await logIntegrationEvent({
      integrationId: config.integrationId,
      level: 'error',
      component: 'capi',
      message: 'capi_event_failed',
      details: JSON.stringify({ eventId: eventData.event_id, error: errorMessage }),
    });
    throw new Error(errorMessage || `CAPI error ${res.status}`);
  }

  await logIntegrationEvent({
    integrationId: config.integrationId,
    level: 'info',
    component: 'capi',
    message: 'capi_event_delivered',
    details: JSON.stringify({ eventId: eventData.event_id, eventName: eventData.event_name }),
  });

  return {
    success: true,
    events_received: body.events_received || 1,
    messages: body.messages || [],
  };
}

/**
 * Queue a CAPI event for reliable delivery with retries.
 */
export async function queueCapiEvent(eventData) {
  const config = getCapiConfig();
  if (!config) {
    throw new AppError(400, 'CAPI not configured: missing pixel_id or page access token');
  }

  const db = getDb();
  const now = new Date().toISOString();

  const info = db.prepare(
    `INSERT INTO meta_capi_events
       (integration_id, pixel_id, event_id, event_name, event_time, action_source,
        user_data, custom_data, test_event_code, status, retry_count, max_retries,
        payload, created_at, next_retry_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, ?, datetime('now'), datetime('now'))`
  ).run(
    config.integrationId,
    config.pixelId,
    eventData.event_id,
    eventData.event_name,
    eventData.event_time || Math.floor(Date.now() / 1000),
    eventData.action_source || 'website',
    JSON.stringify(buildUserData(eventData.user_data)),
    JSON.stringify(eventData.custom_data || {}),
    config.testEventCode || null,
    JSON.stringify({ data: [eventData] }),
  );

  const id = Number(info.lastInsertRowid);

  // Attempt immediate delivery
  try {
    await processCapiQueueItem(db, { ...eventData, id });
  } catch (err) {
    // Will be retried by the processor
  }

  return { id, queued: true };
}

/**
 * Process the CAPI event queue: deliver pending events.
 */
export async function processCapiQueue() {
  const db = getDb();
  const now = new Date().toISOString();

  const items = db.prepare(
    `SELECT * FROM meta_capi_events
     WHERE status = 'pending' AND next_retry_at <= ?
     ORDER BY created_at ASC
     LIMIT 50`
  ).all(now);

  for (const item of items) {
    try {
      const eventData = JSON.parse(item.payload).data[0];
      await processCapiQueueItem(db, { ...eventData, id: item.id });
    } catch (err) {
      const retryCount = item.retry_count + 1;
      const errorMsg = err.message;

      if (retryCount < item.max_retries) {
        const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount - 1);
        const nextRetry = new Date(Date.now() + delayMs).toISOString();
        db.prepare(
          `UPDATE meta_capi_events
             SET status = 'pending', retry_count = ?, next_retry_at = ?, last_error = ?
           WHERE id = ?`
        ).run(retryCount, nextRetry, errorMsg, item.id);
      } else {
        // Move to dead letter queue
        db.prepare(
          `INSERT INTO meta_capi_dead_letter (event_id, integration_id, event_name, event_time, payload, error, attempts, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).run(
          item.event_id,
          item.integration_id,
          item.event_name,
          item.event_time,
          item.payload,
          errorMsg,
          retryCount
        );

        db.prepare(
          `UPDATE meta_capi_events SET status = 'failed', last_error = ? WHERE id = ?`
        ).run(errorMsg, item.id);

        await logIntegrationEvent({
          integrationId: item.integration_id,
          level: 'error',
          component: 'capi',
          message: 'capi_event_dead_letter',
          details: JSON.stringify({ eventId: item.event_id, error: errorMsg }),
        });
      }
    }
  }
}

/**
 * Process a single CAPI queue item: send to Meta and update status.
 */
async function processCapiQueueItem(db, eventData) {
  const config = getCapiConfig();
  if (!config) throw new Error('CAPI not configured');

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.pixelId}/events`;

  const payload = {
    data: [
      {
        event_name: eventData.event_name,
        event_time: eventData.event_time || Math.floor(Date.now() / 1000),
        event_id: eventData.event_id,
        action_source: eventData.action_source || 'website',
        user_data: buildUserData(eventData.user_data),
        custom_data: eventData.custom_data || {},
      },
    ],
  };

  if (config.testEventCode) {
    payload.test_event_code = config.testEventCode;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  const deliveryStatus = res.ok ? 'delivered' : 'failed';
  const errorMessage = res.ok ? null : body.error?.message || `HTTP ${res.status}`;

  await logCapiDelivery({
    integrationId: config.integrationId,
    eventId: eventData.event_id,
    eventName: eventData.event_name,
    eventTime: eventData.event_time || Math.floor(Date.now() / 1000),
    actionSource: eventData.action_source || 'website',
    deliveryStatus,
    errorMessage,
    payload: JSON.stringify(payload),
    response: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(errorMessage || `CAPI error ${res.status}`);
  }

  db.prepare(
    `UPDATE meta_capi_events SET status = 'delivered', delivered_at = datetime('now') WHERE id = ?`
  ).run(eventData.id);

  await logIntegrationEvent({
    integrationId: config.integrationId,
    level: 'info',
    component: 'capi',
    message: 'capi_queue_item_delivered',
    details: JSON.stringify({ eventId: eventData.event_id }),
  });

  return body;
}

/**
 * Log a CAPI delivery attempt to meta_capi_events table (as a delivery log entry).
 */
async function logCapiDelivery({ integrationId, eventId, eventName, eventTime, actionSource, deliveryStatus, errorMessage, payload, response }) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO meta_capi_events
         (integration_id, pixel_id, event_id, event_name, event_time, action_source,
          user_data, custom_data, test_event_code, status, retry_count, max_retries,
          last_error, response_payload, created_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 3, ?, ?, datetime('now'), ?)`
    ).run(
      integrationId,
      getCapiConfig()?.pixelId || null,
      eventId,
      eventName,
      eventTime,
      actionSource,
      null, // user_data (logged separately in queue items)
      null, // custom_data
      null, // test_event_code
      deliveryStatus,
      errorMessage || null,
      payload,
      deliveryStatus === 'delivered' ? new Date().toISOString() : null
    );
  } catch (err) {
    // Logging must never break the request path
    console.error('[CAPI] Delivery log error:', err.message);
  }
}

/**
 * Get CAPI event delivery status for monitoring.
 */
export function getCapiDeliveryStatus(limit = 100) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM meta_capi_events
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(limit);
}

/**
 * Get CAPI dead letter items.
 */
export function getCapiDeadLetters(limit = 50) {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM meta_capi_dead_letter ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

/**
 * Retry a failed CAPI event.
 */
export function retryCapiEvent(eventId) {
  const db = getDb();
  const item = db.prepare(
    `SELECT * FROM meta_capi_events WHERE event_id = ? AND status = 'failed'`
  ).get(eventId);

  if (!item) throw new Error('Failed CAPI event not found');

  db.prepare(
    `UPDATE meta_capi_events
       SET status = 'pending', retry_count = 0, next_retry_at = datetime('now'), last_error = null
     WHERE id = ?`
  ).run(item.id);

  return { retried: true, eventId };
}

/**
 * Check if CAPI is configured and healthy.
 */
export function checkCapiHealth() {
  const config = getCapiConfig();
  if (!config) {
    return { configured: false, reason: 'no_pixel_or_token' };
  }
  return {
    configured: true,
    pixelId: config.pixelId,
    apiVersion: config.apiVersion,
    testEventCode: config.testEventCode || null,
    hasAccessToken: !!config.accessToken,
  };
}

/**
 * Send a test event using Meta's test_event_code.
 * Returns delivery result.
 */
export async function sendTestEvent(eventName = 'PageView') {
  const config = getCapiConfig();
  if (!config || !config.testEventCode) {
    throw new AppError(400, 'CAPI test event code not configured');
  }

  return sendCapiEvent({
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: `test_${Date.now()}`,
    action_source: 'website',
    user_data: {},
    custom_data: {},
    test_event_code: config.testEventCode,
  });
}
