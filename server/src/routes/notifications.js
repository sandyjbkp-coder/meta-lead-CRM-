import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../utils/errorCodes.js';
import { getNotifications, markNotificationRead } from '../services/notification.js';

const router = Router();

// GET /api/notifications - list (user-specific)
router.get('/', async (req, res, next) => {
  try {
    const { unread } = req.query;
    const notifications = getNotifications(req.user.id, unread === 'true');
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read - mark as read
router.post('/:id/read', async (req, res, next) => {
  try {
    const ok = markNotificationRead(req.params.id);
    if (!ok) throw new AppError(404, 'Notification not found');
    res.json({ read: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/read-all - mark all as read
router.post('/read-all', async (req, res, next) => {
  try {
    const db = getDb();
    db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ?`).run(req.user.id);
    res.json({ read: true });
  } catch (err) {
    next(err);
  }
});

export default router;
