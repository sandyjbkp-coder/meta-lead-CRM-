import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/connection.js';
import { getJwtSecret } from '../config/env.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { errors } from '../utils/errorCodes.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

/* --- Schemas --- */
const registerSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

/* --- Routes --- */

/* POST /api/auth/register */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);
    const db = getDb();

    /* Check if any user exists */
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;

    /* First user becomes admin */
    const isFirstUser = userCount === 0;

    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    try {
      const result = db.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active, is_superadmin, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`
      ).run(
        email,
        passwordHash,
        name,
        isFirstUser ? 'admin' : 'sales_exec',
        isFirstUser ? 1 : 0
      );
      user = db.prepare('SELECT id, email, name, role, is_active FROM users WHERE id = ?').get(result.lastInsertRowid);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        throw errors.conflict('Email already registered');
      }
      throw err;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, is_active: user.is_active },
    });
  } catch (err) {
    next(err);
  }
});

/* POST /api/auth/login */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const db = getDb();

    const user = db.prepare(
      'SELECT id, email, password_hash, name, role, is_active FROM users WHERE email = ?'
    ).get(email);

    if (!user) {
      throw errors.unauthorized('Invalid email or password');
    }

    if (!user.is_active) {
      throw errors.unauthorized('Account is disabled');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw errors.unauthorized('Invalid email or password');
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, is_active: user.is_active },
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/auth/me */
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    if (!req.user) {
      throw errors.unauthorized('Not authenticated');
    }
    const db = getDb();
    const user = db.prepare(
      'SELECT id, email, name, role, is_active FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) {
      throw errors.unauthorized('User not found');
    }

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
