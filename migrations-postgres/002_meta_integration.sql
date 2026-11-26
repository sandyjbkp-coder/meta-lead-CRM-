-- Meta integration tables for PostgreSQL

CREATE TABLE IF NOT EXISTS meta_integrations (
  id SERIAL PRIMARY KEY,
  app_id TEXT NOT NULL,
  app_secret TEXT NOT NULL,
  app_secret_encrypted BOOLEAN NOT NULL DEFAULT true,
  page_access_token TEXT NOT NULL,
  page_access_token_encrypted BOOLEAN NOT NULL DEFAULT true,
  verify_token TEXT NOT NULL,
  verify_token_encrypted BOOLEAN NOT NULL DEFAULT true,
  pixel_id TEXT,
  test_event_code TEXT,
  graph_api_version TEXT NOT NULL DEFAULT 'v19.0',
  token_expires_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER,
  last_tested_at TIMESTAMP,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_pages (
  id SERIAL PRIMARY KEY,
  page_id TEXT NOT NULL,
  page_name TEXT NOT NULL,
  page_access_token TEXT,
  integration_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_lead_forms (
  id SERIAL PRIMARY KEY,
  form_id TEXT NOT NULL,
  form_name TEXT,
  page_id TEXT NOT NULL,
  page_name TEXT,
  integration_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  leadgen_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'leadgen',
  page_id TEXT,
  lead_id TEXT,
  payload JSONB,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_webhook_events_event_id ON meta_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_events_leadgen_id ON meta_webhook_events(leadgen_id);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_events_processed ON meta_webhook_events(processed);

CREATE TABLE IF NOT EXISTS meta_capi_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  integration_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_time TIMESTAMP NOT NULL,
  payload JSONB,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_events_event_id ON meta_capi_events(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_status ON meta_capi_events(delivery_status);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_integration_id ON meta_capi_events(integration_id);

CREATE TABLE IF NOT EXISTS meta_token_audit (
  id SERIAL PRIMARY KEY,
  integration_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_integration_logs (
  id SERIAL PRIMARY KEY,
  integration_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meta_sync_jobs (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_meta_sync_jobs_status ON meta_sync_jobs(status);

-- Dead letter queue for failed CAPI events
CREATE TABLE IF NOT EXISTS meta_capi_dead_letter (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  integration_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_time TIMESTAMP NOT NULL,
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_dead_letter_event_id ON meta_capi_dead_letter(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_dead_letter_created_at ON meta_capi_dead_letter(created_at);

-- Webhook processing queue (PostgreSQL-backed, survives restarts)
CREATE TABLE IF NOT EXISTS meta_webhook_queue (
  id SERIAL PRIMARY KEY,
  leadgen_id TEXT NOT NULL,
  form_id TEXT,
  page_id TEXT,
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  event_id TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP,
  next_retry_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_webhook_queue_event_id ON meta_webhook_queue(event_id);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_status ON meta_webhook_queue(status);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_next_retry ON meta_webhook_queue(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_meta_webhook_queue_leadgen_id ON meta_webhook_queue(leadgen_id);
