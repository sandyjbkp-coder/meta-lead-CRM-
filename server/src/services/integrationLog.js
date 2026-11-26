import { getDb } from '../db/connection.js';

// Redact anything that looks like a credential before it reaches the DB or stdout.
const SECRET_PATTERNS = [
  /EA[A-Za-z0-9]{20,}/g, // Meta access tokens
  /[a-f0-9]{32,}/gi, // app secrets / hex tokens
  /"(access_token|app_secret|client_secret|verify_token)"\s*:\s*"[^"]*"/gi,
];

export function redact(value) {
  if (value === null || value === undefined) return value;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[redacted]');
  }
  return text;
}

export async function logIntegrationEvent({ integrationId, level = 'info', component, message, details }) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO meta_integration_logs
         (integration_id, level, component, message, details, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      integrationId || null,
      level,
      component,
      redact(message),
      details ? redact(details) : null
    );
  } catch (err) {
    // Logging must never break the request path.
    console.error('[INTEGRATION_LOG] failed to persist event:', err.message);
  }
}

export function listIntegrationLogs(integrationId, limit = 100) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, level, component, message, details, created_at
         FROM meta_integration_logs
        WHERE (? IS NULL OR integration_id = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?`
    )
    .all(integrationId ?? null, integrationId ?? null, limit);
}
