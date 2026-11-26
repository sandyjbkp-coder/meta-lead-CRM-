import { z } from 'zod';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/* Load .env, searching cwd and up to 3 parent dirs (repo root) */
{
  const candidates = [];
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    candidates.push(path.join(dir, '.env'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
  }
}

/* Handle empty string env vars for optional email fields */
const rawEnv = { ...process.env };
for (const key of ['INITIAL_ADMIN_EMAIL', 'DEFAULT_ASSIGNEE_EMAIL']) {
  if (rawEnv[key] === '') delete rawEnv[key];
}

const envSchema = z.object({
  MASTER_KEY: z.string().min(1, 'MASTER_KEY is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),

  META_APP_ID: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_PAGE_ACCESS_TOKEN: z.string().optional().default(''),
  META_VERIFY_TOKEN: z.string().optional().default('change-me-webhook-verify-token'),
  META_PIXEL_ID: z.string().optional().default(''),
  META_TEST_EVENT_CODE: z.string().optional().default(''),
  DEFAULT_ASSIGNEE_EMAIL: z.string().email().optional(),

  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  DB_FILE: z.string().default('./data/crm.sqlite'),

  DEMO_MODE: z.coerce.boolean().default(false),
  INITIAL_ADMIN_EMAIL: z.string().email().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(1, 'INITIAL_ADMIN_PASSWORD is required'),
  GRAPH_API_VERSION: z.string().optional().default('v19.0'),
});

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('[ENV] Validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

/* Derive a 32-byte AES-256 key from the MASTER_KEY env var. */
export function getMasterKey() {
  const raw = env.MASTER_KEY;
  let buf;
  if (raw.startsWith('base64://')) {
    buf = Buffer.from(raw.slice(9), 'base64');
  } else {
    buf = Buffer.from(raw, 'base64');
  }
  if (buf.length !== 32) {
    buf = crypto.createHmac('sha256', 'meta-crm-master-key-derivation-v1')
      .update(buf)
      .digest();
  }
  return buf;
}

/* Derive a signing key from JWT_SECRET. */
export function getJwtSecret() {
  const raw = env.JWT_SECRET;
  if (raw.startsWith('base64://')) {
    return Buffer.from(raw.slice(9), 'base64');
  }
  return Buffer.from(raw, 'base64');
}

/* Get the configured Meta Graph API version. */
export function getGraphApiVersion() {
  return env.GRAPH_API_VERSION || 'v19.0';
}

/* Check if Meta credentials are configured. */
export function hasMetaCredentials() {
  return !!(env.META_APP_ID && env.META_APP_SECRET && env.META_PAGE_ACCESS_TOKEN);
}

/* Check if CAPI (Conversions API) is configured. */
export function hasCapiConfig() {
  return !!(env.META_PIXEL_ID && env.META_PAGE_ACCESS_TOKEN);
}
