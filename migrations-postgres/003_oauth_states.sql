-- OAuth states and additional tables for PostgreSQL
-- This migration adds columns and tables not covered in 001_init.sql and 002_meta_integration.sql

-- Ensure unique index on meta_webhook_events for leadgen_id + event_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_webhook_events_leadgen_event ON meta_webhook_events(leadgen_id, event_id);

-- Ensure integration_id column exists on meta_capi_events (added in 002, but ensure it exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'meta_capi_events' AND column_name = 'integration_id'
  ) THEN
    ALTER TABLE meta_capi_events ADD COLUMN integration_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_meta_capi_events_integration_id ON meta_capi_events(integration_id);
  END IF;
END $$;

-- Add foreign key constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'meta_capi_events' AND constraint_name = 'fk_meta_capi_events_integration'
  ) THEN
    ALTER TABLE meta_capi_events 
    ADD CONSTRAINT fk_meta_capi_events_integration 
    FOREIGN KEY (integration_id) REFERENCES meta_integrations(id) ON DELETE CASCADE;
  END IF;
END $$;
