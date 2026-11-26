import { getDb } from '../db/connection.js';
import { logActivity } from './activity.js';
import { createNotification } from './notification.js';

// Normalize email (lowercase)
function normalizeEmail(email) {
  return email?.toLowerCase().trim() || '';
}

// Normalize phone (strip non-digits for comparison)
function normalizePhone(phone) {
  return phone?.replace(/\D/g, '') || '';
}

// Upsert a lead with dedup logic:
// 1. If meta_lead_id exists -> update
// 2. Else if email matches -> merge (append note)
// 3. Else if phone matches -> same merge
// 4. Else insert new
export async function upsertLead(leadData) {
  const db = getDb();
  let existing;

  // 1. Check by meta_lead_id
  if (leadData.meta_lead_id) {
    existing = db.prepare(
      `SELECT id, email, phone, full_name, status, assigned_to, custom_fields, follow_up_at, updated_at
       FROM leads WHERE meta_lead_id = ?`
    ).get(leadData.meta_lead_id);
    if (existing) {
      // Idempotent update
      db.prepare(
        `UPDATE leads SET status = ?, assigned_to = ?, follow_up_at = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(leadData.status || existing.status, leadData.assigned_to || existing.assigned_to, leadData.follow_up_at, existing.id);
      logActivity(existing.id, leadData.updated_by || null, 'lead_upserted', existing.status, leadData.status || existing.status);
      return { id: existing.id, meta_lead_id: leadData.meta_lead_id, action: 'updated' };
    }
  }

  // 2. Check by email
  const normEmail = normalizeEmail(leadData.email);
  if (normEmail) {
    existing = db.prepare(
      `SELECT id, email, phone, full_name, status, assigned_to, custom_fields, follow_up_at
       FROM leads WHERE LOWER(email) = ?`
    ).get(normEmail);
    if (existing) {
      // Merge: append note about duplicate, preserve original
      db.prepare(
        `UPDATE leads SET custom_fields = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        JSON.stringify({ ...JSON.parse(existing.custom_fields || '{}'), merged_from_lead: leadData.meta_lead_id }),
        existing.id
      );
      logActivity(existing.id, leadData.updated_by || null, 'duplicate_merged', leadData.meta_lead_id, 'email');
      createNotification(existing.assigned_to, 'duplicate_lead', 'Duplicate lead detected', `A lead with email ${leadData.email} already exists (meta_lead_id ${leadData.meta_lead_id}). Merged.`);
      return { id: existing.id, meta_lead_id: leadData.meta_lead_id, action: 'merged', reason: 'email' };
    }
  }

  // 3. Check by phone
  const normPhone = normalizePhone(leadData.phone);
  if (normPhone) {
    existing = db.prepare(
      `SELECT id, email, phone, full_name, status, assigned_to, custom_fields, follow_up_at
       FROM leads WHERE REPLACE(REPLACE(phone, '+', ''), '-', '') = ?`
    ).get(normPhone);
    if (existing) {
      db.prepare(
        `UPDATE leads SET custom_fields = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        JSON.stringify({ ...JSON.parse(existing.custom_fields || '{}'), merged_from_lead: leadData.meta_lead_id }),
        existing.id
      );
      logActivity(existing.id, leadData.updated_by || null, 'duplicate_merged', leadData.meta_lead_id, 'phone');
      createNotification(existing.assigned_to, 'duplicate_lead', 'Duplicate lead detected', `A lead with phone ${leadData.phone} already exists (meta_lead_id ${leadData.meta_lead_id}). Merged.`);
      return { id: existing.id, meta_lead_id: leadData.meta_lead_id, action: 'merged', reason: 'phone' };
    }
  }

  // 4. Insert new
  const stmt = db.prepare(
    `INSERT INTO leads (
      meta_lead_id, meta_form_id, meta_campaign_id, meta_adset_id, meta_ad_id,
      full_name, email, phone, custom_fields, status, source, assigned_to, follow_up_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  );
  const result = stmt.run(
    leadData.meta_lead_id,
    leadData.meta_form_id || '',
    leadData.meta_campaign_id || '',
    leadData.meta_adset_id || '',
    leadData.meta_ad_id || '',
    leadData.full_name || '',
    leadData.email || '',
    leadData.phone || '',
    leadData.custom_fields ? JSON.stringify(leadData.custom_fields) : '{}',
    leadData.status || 'new',
    leadData.source || 'meta_ads',
    leadData.assigned_to || null,
    leadData.follow_up_at || null
  );
  return { id: result.lastInsertRowid, meta_lead_id: leadData.meta_lead_id, action: 'inserted' };
}

// Auto-assign a lead to default sales exec if not assigned
export function autoAssignLead(lead) {
  const db = getDb();
  if (lead.assigned_to) return lead.assigned_to;
  const defaultEmail = process.env.DEFAULT_ASSIGNEE_EMAIL;
  if (defaultEmail) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(defaultEmail);
    if (user) {
      db.prepare(`UPDATE leads SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?`).run(user.id, lead.id);
      lead.assigned_to = user.id;
      return lead.assigned_to;
    }
  }
  // Fallback to first available exec
  const exec = db.prepare('SELECT id FROM users WHERE role = ? ORDER BY id LIMIT 1').get('sales_exec');
  if (exec) {
    db.prepare(`UPDATE leads SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?`).run(exec.id, lead.id);
    lead.assigned_to = exec.id;
  }
  return lead.assigned_to;
}

// Parse and normalize Meta field_data array into structured lead
export function parseMetaFields(fieldData) {
  const fields = {};
  for (const f of fieldData) {
    fields[f.name] = f.values ? f.values[0] : '';
  }

  // Map to our schema
  return {
    full_name: fields.full_name || fields.fullname || `${fields.first_name || ''} ${fields.last_name || ''}`.trim() || 'Unknown',
    email: fields.email || fields.email_address || '',
    phone: fields.phone || fields.phone_number || '',
    custom_fields: fields, // keep all raw fields
  };
}
