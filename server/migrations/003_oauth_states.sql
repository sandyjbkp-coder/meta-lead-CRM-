-- 003_oauth_states.sql: Phase 2A OAuth state persistence + CAPI tables
-- OAuth states must survive server restarts (in-memory Map is lost on restart).
-- Also adds webhook replay protection and CAPI delivery log improvements.

-- OAuth state store (persisted, single-use, time-limited)
CREATE TABLE IF NOT EXISTS meta_oauth_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  redirect_uri TEXT,
  scopes TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_oauth_states_state ON meta_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_states_expires ON meta_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_meta_oauth_states_used ON meta_oauth_states(used);

-- Webhook event dedup / replay protection is already in meta_webhook_events (event_id unique).
-- Ensure leadgen_id + event_id combination is unique to prevent duplicate processing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_webhook_events_leadgen_event ON meta_webhook_events(leadgen_id, event_id);

-- Ensure integration_id column exists on meta_capi_events (added if missing)
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS directly, so we try/catch via the runner.
ALTER TABLE meta_capi_events ADD COLUMN integration_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_integration_id ON meta_capi_events(integration_id);

-- Dead letter queue for failed CAPI events
CREATE TABLE IF NOT EXISTS meta_capi_dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  integration_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_time TEXT NOT NULL,
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_dead_letter_event_id ON meta_capi_dead_letter(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_dead_letter_created_at ON meta_capi_dead_letter(created_at);

-- Webhook processing queue (SQLite-backed, survives restarts)
CREATE TABLE IF NOT EXISTS meta_webhook_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leadgen_id TEXT NOT NULL,
  form_id TEXT,
  page_id TEXT,
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  event_id TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  next_retry_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_webhook_queue_event_id ON meta_webhook_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_status ON meta_webhook_queue(status);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_next_retry ON meta_webhook_queue(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_leadgen_id ON meta_webhook_queue(leadgen_id);
