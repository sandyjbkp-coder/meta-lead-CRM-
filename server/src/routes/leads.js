import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole, canViewAllLeads, canReassignLead, canEditLead } from '../middleware/rbac.js';
import { AppError } from '../utils/errorCodes.js';
import { logActivity } from '../services/activity.js';
import { createNotification } from '../services/notification.js';
import { upsertLead, autoAssignLead } from '../services/leadService.js';

const router = Router();

// All routes require auth (applied at index.js level)

// GET /api/leads - list with filters, search, pagination (role-filtered)
router.get('/', async (req, res, next) => {
  try {
    const { q, status, campaign, assignee, page = '1', limit = '20', sort = 'created_at', order = 'desc' } = req.query;
    const db = getDb();
    const user = req.user;

    let sql = `SELECT l.*, u.name as assigned_to_name, u.email as assigned_to_email
               FROM leads l LEFT JOIN users u ON u.id = l.assigned_to
               WHERE 1=1`;
    const params = [];

    // Role-based filtering
    if (!canViewAllLeads(user)) {
      sql += ` AND l.assigned_to = ?`;
      params.push(user.id);
    }

    if (q) {
      sql += ` AND (l.full_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.meta_lead_id LIKE ?)`;
      const likeQ = `%${q}%`;
      params.push(likeQ, likeQ, likeQ, likeQ);
    }
    if (status) {
      sql += ` AND l.status = ?`;
      params.push(status);
    }
    if (campaign) {
      sql += ` AND l.meta_campaign_id = ?`;
      params.push(campaign);
    }
    if (assignee) {
      sql += ` AND l.assigned_to = ?`;
      params.push(assignee);
    }

    // Count total
    const countSql = sql.replace('SELECT l.*, u.name as assigned_to_name, u.email as assigned_to_email FROM leads l LEFT JOIN users u ON u.id = l.assigned_to', 'SELECT COUNT(*) as total FROM leads l LEFT JOIN users u ON u.id = l.assigned_to');
    const totalRow = db.prepare(countSql).get(...params);
    const total = totalRow.total;

    // Sort and paginate
    const orderBy = {
      created_at: 'l.created_at',
      full_name: 'l.full_name',
      status: 'l.status',
      email: 'l.email',
      updated_at: 'l.updated_at',
    }[sort] || 'l.created_at';
    const orderDir = order === 'asc' ? 'ASC' : 'DESC';
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const offset = (pageNum - 1) * limitNum;

    sql += ` ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const leads = db.prepare(sql).all(...params);
    res.json({ leads, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) {
    next(err);
  }
});

// GET /api/leads/:id - detail
router.get('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const lead = db.prepare(`SELECT l.*, u.name as assigned_to_name, u.email as assigned_to_email FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id = ?`).get(req.params.id);

    if (!lead) throw new AppError(404, 'Lead not found');

    // Role check: if not admin/manager, must be assigned to this user
    if (!canViewAllLeads(req.user) && lead.assigned_to !== req.user.id) {
      throw new AppError(403, 'Forbidden: lead not assigned to you');
    }

    // Get notes
    const notes = db.prepare(`SELECT n.*, u.name as author_name, u.email as author_email FROM lead_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.lead_id = ? ORDER BY n.created_at DESC`).all(lead.id);

    // Get activities
    const activities = db.prepare(`SELECT a.*, u.name as user_name FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.lead_id = ? ORDER BY a.created_at DESC`).all(lead.id);

    res.json({ lead: { ...lead, custom_fields: JSON.parse(lead.custom_fields || '{}') }, notes, activities });
  } catch (err) {
    next(err);
  }
});

// POST /api/leads - create manual lead (admin/manager)
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const schema = z.object({
      full_name: z.string().min(1),
      email: z.string().email(),
      phone: z.string().optional(),
      meta_form_id: z.string().optional(),
      meta_campaign_id: z.string().optional(),
      meta_adset_id: z.string().optional(),
      meta_ad_id: z.string().optional(),
      custom_fields: z.record(z.any()).optional(),
      status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']).optional(),
      assigned_to: z.number().int().optional(),
      follow_up_at: z.string().optional(),
      source: z.string().optional(),
    });

    const data = schema.parse(req.body);
    const result = await upsertLead({
      ...data,
      updated_by: req.user.id,
    });

    res.status(201).json({ id: result.id, action: result.action });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/leads/:id - update status / assign / follow-up
router.patch('/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) throw new AppError(404, 'Lead not found');

    if (!canEditLead(req.user, lead)) {
      throw new AppError(403, 'Forbidden: cannot edit this lead');
    }

    const schema = z.object({
      status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']).optional(),
      assigned_to: z.number().int().optional(),
      follow_up_at: z.string().optional(),
      custom_fields: z.record(z.any()).optional(),
    });

    const data = schema.parse(req.body);

    if (data.status && data.status !== lead.status) {
      db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(data.status, lead.id);
      logActivity(lead.id, req.user.id, 'status_changed', lead.status, data.status);
      createNotification(lead.assigned_to, 'status_change', `Lead status changed`, `Lead "${lead.full_name}" moved from ${lead.status} to ${data.status}`);
    }

    if (data.assigned_to && data.assigned_to !== lead.assigned_to) {
      if (!canReassignLead(req.user, lead)) {
        throw new AppError(403, 'Forbidden: cannot reassign this lead');
      }
      db.prepare(`UPDATE leads SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?`).run(data.assigned_to, lead.id);
      logActivity(lead.id, req.user.id, 'reassigned', String(lead.assigned_to), String(data.assigned_to));
      createNotification(data.assigned_to, 'lead_assigned', 'New lead assigned', `Lead "${lead.full_name}" has been assigned to you`);
    }

    if (data.follow_up_at && data.follow_up_at !== lead.follow_up_at) {
      db.prepare(`UPDATE leads SET follow_up_at = ?, updated_at = datetime('now') WHERE id = ?`).run(data.follow_up_at, lead.id);
      logActivity(lead.id, req.user.id, 'follow_up_updated', lead.follow_up_at, data.follow_up_at);
    }

    if (data.custom_fields) {
      db.prepare(`UPDATE leads SET custom_fields = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(data.custom_fields), lead.id);
      logActivity(lead.id, req.user.id, 'custom_fields_updated', null, null);
    }

    res.json({ id: lead.id, updated: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leads/:id - delete lead (admin only)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) throw new AppError(404, 'Lead not found');

    db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/leads/:id/notes - add note
router.post('/:id/notes', async (req, res, next) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT id, assigned_to FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) throw new AppError(404, 'Lead not found');

    if (!canViewAllLeads(req.user) && lead.assigned_to !== req.user.id) {
      throw new AppError(403, 'Forbidden: lead not assigned to you');
    }

    const schema = z.object({ body: z.string().min(1) });
    const { body } = schema.parse(req.body);

    const result = db.prepare(
      `INSERT INTO lead_notes (lead_id, user_id, body, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).run(lead.id, req.user.id, body);

    logActivity(lead.id, req.user.id, 'note_added', null, null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leads/:id/notes/:noteId - delete note (admin/manager only)
router.delete('/:id/notes/:noteId', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const db = getDb();
    const note = db.prepare('SELECT id FROM lead_notes WHERE id = ? AND lead_id = ?').get(req.params.noteId, req.params.id);
    if (!note) throw new AppError(404, 'Note not found');

    db.prepare('DELETE FROM lead_notes WHERE id = ?').run(note.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/leads/:id/activities - list activities
router.get('/:id/activities', async (req, res, next) => {
  try {
    const db = getDb();
    const lead = db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) throw new AppError(404, 'Lead not found');

    const activities = db.prepare(
      `SELECT a.*, u.name as user_name FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.lead_id = ? ORDER BY a.created_at DESC`
    ).all(lead.id);

    res.json({ activities });
  } catch (err) {
    next(err);
  }
});

export default router;
