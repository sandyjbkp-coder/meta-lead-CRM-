#!/usr/bin/env node
import { getDb, initModels } from './connection.js';
import seed from './seed.js';

async function main() {
  initModels();
  await seed();
}

main().catch(err => {
  console.error('[SEED] Fatal error:', err);
  process.exit(1);
});
