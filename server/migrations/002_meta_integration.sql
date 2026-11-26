-- 002_meta_integration.sql: Phase 2 Meta Integration Tables
-- Run via: node server/src/db/migrate.js
-- Requires: server/migrations/ directory exists

-- Meta integrations (per-app configuration)
CREATE TABLE IF NOT EXISTS meta_integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL, -- encrypted at rest
  app_secret_encrypted INTEGER NOT NULL DEFAULT 1,
  page_access_token TEXT NOT NULL, -- encrypted at rest
  page_access_token_encrypted INTEGER NOT NULL DEFAULT 1,
  verify_token TEXT NOT NULL, -- encrypted at rest
  verify_token_encrypted INTEGER NOT NULL DEFAULT 1,
  pixel_id TEXT,
  test_event_code TEXT,
  graph_api_version TEXT NOT NULL DEFAULT 'v19.0',
  token_expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  last_tested_at TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Meta pages (pages with lead forms)
CREATE TABLE IF NOT EXISTS meta_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_access_token TEXT,
  integration_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

-- Meta lead forms
CREATE TABLE IF NOT EXISTS meta_lead_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT NOT NULL,
  form_name TEXT,
  page_id TEXT NOT NULL,
  page_name TEXT,
  integration_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

-- Webhook events (received from Meta)
CREATE TABLE IF NOT EXISTS meta_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL, -- Meta event_id
  leadgen_id TEXT NOT NULL,
  form_id TEXT,
  page_id TEXT,
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  raw_payload TEXT NOT NULL,
  signature TEXT,
  signature_verified INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  processing_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

-- Sync jobs (manual + scheduled)
CREATE TABLE IF NOT EXISTS meta_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL, -- 'manual', 'scheduled', 'webhook'
  form_id TEXT,
  page_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
  leads_fetched INTEGER NOT NULL DEFAULT 0,
  leads_inserted INTEGER NOT NULL DEFAULT 0,
  leads_merged INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conversions API events
CREATE TABLE IF NOT EXISTS meta_capi_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_id TEXT NOT NULL,
  pixel_id TEXT NOT NULL,
  test_event_code TEXT,
  user_data_hash TEXT,
  action_source TEXT NOT NULL DEFAULT 'website',
  payload TEXT NOT NULL,
  meta_response TEXT,
  meta_event_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending', -- pending, delivered, failed
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

-- Token audit log
CREATE TABLE IF NOT EXISTS meta_token_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  action TEXT NOT NULL, -- 'oauth_grant', 'oauth_refresh', 'token_test', 'token_expired'
  status TEXT NOT NULL, -- 'success', 'failure'
  error TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

-- Integration logs
CREATE TABLE IF NOT EXISTS meta_integration_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  level TEXT NOT NULL, -- 'info', 'warn', 'error'
  component TEXT NOT NULL, -- 'oauth', 'webhook', 'capi', 'sync'
  message TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meta_webhook_events_event_id ON meta_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_events_leadgen_id ON meta_webhook_events(leadgen_id);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_events_processed ON meta_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_event_id ON meta_capi_events(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_status ON meta_capi_events(delivery_status);
CREATE INDEX IF NOT EXISTS idx_meta_sync_jobs_status ON meta_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_meta_token_audit_integration_id ON meta_token_audit(integration_id);
CREATE INDEX IF NOT EXISTS idx_meta_integration_logs_integration_id ON meta_integration_logs(integration_id);
CREATE INDEX IF NOT EXISTS idx_meta_pages_page_id ON meta_pages(page_id);
CREATE INDEX IF NOT EXISTS idx_meta_lead_forms_form_id ON meta_lead_forms(form_id);
