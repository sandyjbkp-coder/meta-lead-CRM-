import { getDb, initModels } from './connection.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// Need to set DATABASE_URL or use SQLite; this uses SQLite by default for seed
async function main() {
  // Auto-init tables first
  initModels();
  
  const db = getDb();
  
  // Check if data already exists
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const leadCount = db.prepare('SELECT COUNT(*) as c FROM leads').get().c;
  
  if (userCount > 0 && leadCount > 0) {
    console.log('[SEED] Data already exists, skipping seed.');
    return;
  }
  
  console.log('[SEED] Initializing demo data...');
  
  // Create first admin user
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@metacrm.local';
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
  
  // Check if admin already exists
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (existingAdmin) {
    console.log('[SEED] Admin user already exists, skipping creation.');
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const result = db.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active, is_superadmin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))`
    ).run(adminEmail, passwordHash, 'Super Admin');
    
    const adminId = result.lastInsertRowid;
    console.log(`[SEED] Created admin user: ${adminEmail} (id: ${adminId})`);
  }
  
  // Create manager user
  const managerEmail = 'manager@metacrm.local';
  const managerExisting = db.prepare('SELECT id FROM users WHERE email = ?').get(managerEmail);
  if (!managerExisting) {
    const managerPasswordHash = await bcrypt.hash('manager123', 10);
    db.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active, is_superadmin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))`
    ).run(managerEmail, managerPasswordHash, 'Manager User');
    console.log('[SEED] Created manager user: manager@metacrm.local');
  }
  
  // Create sales exec user
  const salesExecEmail = 'sales@metacrm.local';
  const salesExecExisting = db.prepare('SELECT id FROM users WHERE email = ?').get(salesExecEmail);
  if (!salesExecExisting) {
    const salesExecPasswordHash = await bcrypt.hash('sales123', 10);
    db.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active, is_superadmin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))`
    ).run(salesExecEmail, salesExecPasswordHash, 'Sales Exec User');
    console.log('[SEED] Created sales exec: sales@metacrm.local');
  }
  
  // Create 25 demo leads if table is empty
  if (leadCount === 0) {
    const statuses = ['new', 'contacted', 'qualified', 'proposal', 'closed_won', 'closed_lost'];
    const sources = ['meta_ads', 'landing_page', 'referral'];
    
    for (let i = 1; i <= 25; i++) {
      const status = statuses[i % statuses.length];
      const source = sources[i % sources.length];
      const assignedTo = (i % 3) + 1; // assign to first 3 users
      
      const customFields = JSON.stringify({
        first_name: `Lead${i}`,
        last_name: `Test${i}`,
        company: `Company${i}`,
        industry: `Industry${i % 5}`,
      });
      
      const followUpAt = i % 5 === 0 
        ? new Date(Date.now() + (i * 86400000)).toISOString()  // spread out over days
        : null;
      
      try {
        db.prepare(
          `INSERT INTO leads (meta_lead_id, meta_form_id, meta_campaign_id, meta_adset_id, meta_ad_id, full_name, email, phone, custom_fields, status, source, assigned_to, follow_up_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
        ).run(
          `meta_lead_${i}`,
          `form_${i}`,
          `campaign_${i % 3}`,
          `adset_${i % 2}`,
          `ad_${i}`,
          `Lead ${i}`,
          `lead${i}@metacrm.local`,
          `555-0${i}`,
          customFields,
          status,
          source,
          assignedTo,
          followUpAt
        );
      } catch (err) {
        // Some leads may have duplicate meta_lead_id constraints, skip silently
      }
    }
    console.log('[SEED] Created 25 demo leads');
  }
  
  // Initialize other tables
  initModels();
  
  console.log('[SEED] Demo data initialization complete');
}

main().catch(err => {
  console.error('[SEED] Fatal error:', err);
  process.exit(1);
});
