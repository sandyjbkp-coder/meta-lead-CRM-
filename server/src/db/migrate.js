import path from 'node:path';
import fs from 'node:fs';
import { getDb, getDialect, isPostgres, isSqlite } from './connection.js';

function getMigrationDirs(repoRoot = process.cwd()) {
  return {
    migrationsDir: path.join(repoRoot, 'migrations'),
    pgMigrationsDir: path.join(repoRoot, 'migrations-postgres'),
  };
}

function stripSqlitePragmas(sql) {
  return sql.replace(/^\s*PRAGMA\s+[^;]+;/gm, '').trim();
}

function sqliteAutoincrementToPostgres(sql) {
  return sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY');
}

function sqliteDatetimeNowToPostgres(sql) {
  return sql
    .replace(/datetime\('now'\)/g, 'now()')
    .replace(/date\('now'\)/g, 'CURRENT_DATE')
    .replace(/date\('now', '-(\d+) days'\)/g, "(CURRENT_DATE - interval '$1 days')");
}

function convertSqliteToPostgres(sql) {
  let converted = stripSqlitePragmas(sql);
  converted = sqliteAutoincrementToPostgres(converted);
  converted = sqliteDatetimeNowToPostgres(converted);
  converted = converted.replace(/BOOLEAN DEFAULT (\d)/g, "BOOLEAN DEFAULT '$1'");
  return converted;
}

/**
 * Properly split SQL into statements, handling:
 * - Quoted strings (single, double, dollar-quoted)
 * - Comments (-- and block comments)
 * - PL/pgSQL blocks (BEGIN ... END;)
 * - Semicolons inside strings/comments
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inDollarQuote = false;
  let dollarQuoteTag = '';
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] || '';

    // Handle dollar-quoted strings ($tag$ ... $tag$)
    if (!inSingleQuote && !inDoubleQuote && !inLineComment && !inBlockComment) {
      if (ch === '$' && /^[\w_]*\$/.test(sql.slice(i))) {
        const match = sql.slice(i).match(/^\$([\w_]*)\$/);
        if (match) {
          if (!inDollarQuote) {
            inDollarQuote = true;
            dollarQuoteTag = match[1];
            current += match[0];
            i += match[0].length;
            continue;
          } else if (dollarQuoteTag === match[1]) {
            inDollarQuote = false;
            dollarQuoteTag = '';
            current += match[0];
            i += match[0].length;
            continue;
          }
        }
      }
    }

    if (inDollarQuote) {
      current += ch;
      i++;
      continue;
    }

    // Handle single quotes
    if (!inDoubleQuote && !inLineComment && !inBlockComment && !inDollarQuote) {
      if (ch === "'" && next !== "'") {
        inSingleQuote = !inSingleQuote;
        current += ch;
        i++;
        continue;
      }
      if (ch === "'" && next === "'") {
        current += "''";
        i += 2;
        continue;
      }
    }

    // Handle double quotes
    if (!inSingleQuote && !inLineComment && !inBlockComment && !inDollarQuote) {
      if (ch === '"' && next !== '"') {
        inDoubleQuote = !inDoubleQuote;
        current += ch;
        i++;
        continue;
      }
      if (ch === '"' && next === '"') {
        current += '""';
        i += 2;
        continue;
      }
    }

    // Handle comments
    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote) {
      if (!inBlockComment && ch === '-' && next === '-') {
        inLineComment = true;
        current += '--';
        i += 2;
        continue;
      }
      if (!inLineComment && ch === '/' && next === '*') {
        inBlockComment = true;
        current += '/*';
        i += 2;
        continue;
      }
      if (inLineComment && ch === '\n') {
        inLineComment = false;
        current += ch;
        i++;
        continue;
      }
      if (inBlockComment && ch === '*' && next === '/') {
        inBlockComment = false;
        current += '*/';
        i += 2;
        continue;
      }
    }

    // Handle statement terminator
    if (!inSingleQuote && !inDoubleQuote && !inDollarQuote && !inLineComment && !inBlockComment) {
      if (ch === ';') {
        const trimmed = current.trim();
        if (trimmed) {
          statements.push(trimmed);
        }
        current = '';
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  // Add any remaining statement
  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  // Post-process: strip leading comments from each statement
  return statements.map(stmt => {
    // Remove leading line comments and whitespace
    return stmt.replace(/^(?:\s*--[^\n]*\n)+\s*/, '');
  }).filter(stmt => stmt.trim());
}

export function migrate(repoRoot = process.cwd()) {
  const { migrationsDir } = getMigrationDirs(repoRoot);

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) {
    console.log('[MIGR] No migration files');
    return;
  }

  console.log('[MIGR] Running', files.length, 'migrations...');

  if (isPostgres()) {
    console.log('[MIGR] PostgreSQL mode detected - run "npm run migrate-pg" for PostgreSQL migrations');
    return;
  }

  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
    try {
      getDb().exec(sql);
      console.log(`[MIGR] Applied ${f}`);
    } catch (err) {
      if (!err.message.includes('duplicate column') && !err.message.includes('duplicate index') && !err.message.includes('already exists')) {
        console.error(`[MIGR] ${f}:`, err.message);
      }
    }
  }
  console.log('[MIGR] Done');
}

export async function migratePg(repoRoot = process.cwd()) {
  if (!isPostgres()) {
    console.log('[MIGR] Not in PostgreSQL mode. Set DATABASE_URL to run PostgreSQL migrations.');
    return;
  }

  const { pgMigrationsDir } = getMigrationDirs(repoRoot);
  const db = getDb();

  if (!fs.existsSync(pgMigrationsDir)) {
    console.log('[MIGR] No PostgreSQL migrations directory at', pgMigrationsDir);
    return;
  }

  const files = fs.readdirSync(pgMigrationsDir).filter(f => f.endsWith('.sql')).sort();
  if (!files.length) {
    console.log('[MIGR] No PostgreSQL migration files');
    return;
  }

  console.log('[MIGR] Running', files.length, 'PostgreSQL migrations...');

  // Ensure migration tracking table exists
  await ensureMigrationTrackingTable(db);

  for (const f of files) {
    // Check if migration already applied
    const alreadyApplied = await isMigrationApplied(db, f);
    if (alreadyApplied) {
      console.log(`[MIGR] Skipping ${f} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(pgMigrationsDir, f), 'utf-8');
    const statements = splitSqlStatements(sql).filter(s => s.trim() && !s.trim().startsWith('--'));

    if (statements.length === 0) {
      console.log(`[MIGR] ${f}: no executable statements`);
      await recordMigration(db, f, true);
      continue;
    }

    // Run migration in a transaction
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      for (const stmt of statements) {
        try {
          await client.query(stmt);
          console.log(`[MIGR] Applied ${f}: ${stmt.substring(0, 80)}...`);
        } catch (stmtErr) {
          // Check if it's a genuine idempotent error
          const msg = stmtErr.message.toLowerCase();
          const isIdempotent = msg.includes('already exists') || 
                               msg.includes('duplicate key') ||
                               msg.includes('duplicate index') ||
                               msg.includes('relation') && msg.includes('already exists');
          
          if (!isIdempotent) {
            throw stmtErr; // Will trigger rollback
          }
          console.log(`[MIGR] ${f} (idempotent): ${stmtErr.message}`);
        }
      }
      
      await client.query('COMMIT');
      await recordMigration(db, f, true);
      console.log(`[MIGR] Migration ${f} completed successfully`);
      
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[MIGR] FATAL ${f}:`, err.message);
      await recordMigration(db, f, false, err.message);
      throw new Error(`Migration ${f} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log('[MIGR] PostgreSQL migrations complete');
}

async function ensureMigrationTrackingTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW(),
      success BOOLEAN NOT NULL DEFAULT true,
      error_message TEXT
    )
  `);
}

async function isMigrationApplied(db, filename) {
  const result = await db.query(
    'SELECT success FROM _migrations WHERE filename = $1',
    [filename]
  );
  return result.rows.length > 0 && result.rows[0].success === true;
}

async function recordMigration(db, filename, success, errorMessage = null) {
  await db.query(
    `INSERT INTO _migrations (filename, success, error_message)
     VALUES ($1, $2, $3)
     ON CONFLICT (filename) DO UPDATE SET
       applied_at = NOW(),
       success = EXCLUDED.success,
       error_message = EXCLUDED.error_message`,
    [filename, success, errorMessage]
  );
}
