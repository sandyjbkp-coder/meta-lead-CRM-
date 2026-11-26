#!/usr/bin/env node
// Async migration runner for PostgreSQL
// Usage: node server/migrate-pg.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migratePg } from './src/db/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
  try {
    await migratePg(repoRoot);
    process.exit(0);
  } catch (err) {
    console.error('[MIGR-PG] Failed:', err.message);
    process.exit(1);
  }
}

main();
