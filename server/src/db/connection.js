import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

let pgPool = null;
let sqliteDb = null;
let currentDialect = null; // 'sqlite' | 'postgres'

export function getDb() {
  if (!pgPool && !sqliteDb && !currentDialect) {
    const databaseUrl = process.env.DATABASE_URL;
    
    if (databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://'))) {
      return createPgConnection();
    } else {
      return _getOrCreateSqlite();
    }
  }
  
  if (currentDialect === 'postgres') {
    return createPgProxy();
  }
  
  return _getOrCreateSqlite();
}

function _getOrCreateSqlite() {
  if (!sqliteDb) {
    const dbPath = process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'crm.sqlite');
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec('PRAGMA journal_mode = WAL');
    sqliteDb.exec('PRAGMA synchronous = NORMAL');
    sqliteDb.exec('PRAGMA foreign_keys = ON');
    console.log(`[DB] Connected to SQLite: ${dbPath}`);
    currentDialect = 'sqlite';
  }
  return sqliteDb;
}

function createPgConnection() {
  if (pgPool) return createPgProxy();
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('[DB] DATABASE_URL is required for PostgreSQL mode');
  }
  
  currentDialect = 'postgres';
  
  pgPool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  });
  
  pgPool.on('error', (err) => {
    console.error('[PG] Unexpected pool error:', err);
  });
  
  console.log('[DB] Connected to PostgreSQL');
  
  return createPgProxy();
}

function createPgProxy() {
  return {
    prepare(sql) {
      throw new Error('[DB] prepare() is not supported in PostgreSQL mode. Use db.query(sql, params) instead.');
    },
    exec(sql) {
      throw new Error('[DB] exec() is not supported in PostgreSQL mode. Use db.query(sql, params) instead.');
    },
    async query(sql, params = []) {
      const client = await pgPool.connect();
      try {
        const result = await client.query(sql, params);
        return result;
      } finally {
        client.release();
      }
    },
    async getClient() {
      return pgPool.connect();
    },
    get dialect() { return 'postgres'; },
    get isPostgres() { return true; },
    get isSqlite() { return false; },
  };
}

export function closeDb() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
    console.log('[DB] SQLite closed');
  }
  if (pgPool) {
    pgPool.end().then(() => {
      console.log('[DB] PostgreSQL pool closed');
    }).catch((err) => {
      console.error('[DB] Error closing PostgreSQL pool:', err.message);
    });
    pgPool = null;
  }
  currentDialect = null;
}

export function getDialect() {
  if (!currentDialect) {
    getDb();
  }
  return currentDialect;
}

export function isPostgres() {
  return getDialect() === 'postgres';
}

export function isSqlite() {
  return getDialect() === 'sqlite';
}

export function initModels() {
  // In PostgreSQL mode, schema is managed by migratePg() — do not initialize SQLite
  if (isPostgres()) {
    console.log('[DB] PostgreSQL mode: skipping SQLite initModels (schema managed by migratePg)');
    return;
  }
  
  const database = _getOrCreateSqlite();
  
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'sales_exec',
      is_active INTEGER NOT NULL DEFAULT 1,
      is_superadmin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meta_lead_id TEXT UNIQUE,
      meta_form_id TEXT NOT NULL,
      meta_campaign_id TEXT,
      meta_adset_id TEXT,
      meta_ad_id TEXT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      custom_fields TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'new',
      source TEXT DEFAULT 'meta_ads',
      assigned_to INTEGER,
      follow_up_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS lead_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS meta_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id TEXT UNIQUE NOT NULL,
      name TEXT,
      page_id TEXT,
      campaign_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS meta_sync_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leadgen_id TEXT NOT NULL,
      form_id TEXT,
      error TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_meta_lead_id ON leads(meta_lead_id);
    CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
    CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_id ON lead_notes(lead_id);
    CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON lead_activities(lead_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_meta_forms_form_id ON meta_forms(form_id);
  `);

  database.exec(`
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
  `);

  console.log('[DB] SQLite models initialized with indexes');
}
