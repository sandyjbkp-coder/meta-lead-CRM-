import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { bcrypt } from '../services/crypto.js';
import { requireRole, canManageUsers } from '../middleware/rbac.js';
import { AppError } from '../utils/errorCodes.js';

const router = Router();

// GET /api/users - list users (admin only)
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const users = db.prepare(
      `SELECT id, email, name, role, is_active, is_superadmin, created_at, updated_at FROM users`
    ).all();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// POST /api/users - create user (admin only)
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(1),
      role: z.enum(['sales_exec', 'manager', 'admin']).optional(),
    });

    const { email, password, name, role } = schema.parse(req.body);
    const db = getDb();

    const passwordHash = await bcrypt.hash(password, 10);

    const result = db.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active, is_superadmin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))`
    ).run(email, passwordHash, name || 'User', role || 'sales_exec');

    const user = db.prepare('SELECT id, email, name, role, is_active FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/users/:id - update user (admin only)
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    const schema = z.object({
      email: z.string().email().optional(),
      name: z.string().optional(),
      role: z.enum(['sales_exec', 'manager', 'admin']).optional(),
      is_active: z.boolean().optional(),
    });

    const data = schema.parse(req.body);
    const updateFields = [];
    const params = [];

    if (data.email !== undefined) {
      updateFields.push(`email = ?`);
      params.push(data.email);
    }
    if (data.name !== undefined) {
      updateFields.push(`name = ?`);
      params.push(data.name);
    }
    if (data.role !== undefined) {
      updateFields.push(`role = ?`);
      params.push(data.role);
    }
    if (data.is_active !== undefined) {
      updateFields.push(`is_active = ?`);
      params.push(data.is_active ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return res.json({ updated: false, reason: 'no changes' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updateFields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);

    const user = db.prepare('SELECT id, email, name, role, is_active FROM users WHERE id = ?').get(req.params.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/users/:id - delete user (superadmin only)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const db = getDb();
    // Prevent deleting the last admin
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('admin').c;
    if (userCount <= 1) {
      throw new AppError(400, 'Cannot delete the last admin user');
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
