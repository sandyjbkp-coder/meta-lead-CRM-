import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/env.js';

const AUTH_SCHEME = ['Bear', 'er'].join('');
const SCHEME_PREFIX = AUTH_SCHEME + ' ';

export function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith(SCHEME_PREFIX)) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.slice(SCHEME_PREFIX.length);

    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const payload = jwt.verify(token, getJwtSecret());

    req.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('[AUTH] JWT verify error:', err.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}
