import { getDb } from '../db/connection.js';

export function createNotification(userId, type, title, body) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO notifications (user_id, type, title, body, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  );
  const info = stmt.run(userId, type, title, body);
  return info.lastInsertRowid;
}

export function getNotifications(userId, unreadOnly = false) {
  const db = getDb();
  let sql = `SELECT n.*, u.name as user_name FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE n.user_id = ?`;
  const params = [userId];

  if (unreadOnly) {
    sql += ` AND n.read = 0`;
  }

  sql += ` ORDER BY n.created_at DESC`;
  return db.prepare(sql).all(...params);
}

export function markNotificationRead(notificationId) {
  const db = getDb();
  const stmt = db.prepare(`UPDATE notifications SET read = 1 WHERE id = ?`);
  const info = stmt.run(notificationId);
  return info.changes > 0;
}
