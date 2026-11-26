import { getDb } from '../db/connection.js';

export function logActivity(leadId, userId, action, fromValue = null, toValue = null) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO lead_activities (lead_id, user_id, action, from_value, to_value, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  );
  const info = stmt.run(leadId, userId || null, action, fromValue, toValue);
  return info.lastInsertRowid;
}

export function getActivities(leadId) {
  const db = getDb();
  return db.prepare(
    `SELECT a.*, u.name as user_name, u.email as user_email
     FROM lead_activities a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.lead_id = ?
     ORDER BY a.created_at DESC`
  ).all(leadId);
}
