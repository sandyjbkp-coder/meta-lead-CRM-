// Lightweight in-process rate limiter (no external dependency).
// Sliding-window counters keyed by client IP. Adequate for a single-instance
// deployment on Render; swap for a Redis-backed store if you scale out.

const buckets = new Map();

function clientKey(req, scope) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null)
    || req.socket?.remoteAddress
    || 'unknown';
  return `${scope}:${ip}`;
}

function prune(map, now) {
  if (map.size < 5000) return;
  for (const [k, v] of map) {
    if (v.resetAt <= now) map.delete(k);
  }
}

export function createRateLimiter({ windowMs, max, scope, message }) {
  const store = new Map();
  buckets.set(scope, store);

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    prune(store, now);

    const key = clientKey(req, scope);
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json(message || { error: 'Too many requests, please try again later' });
    }

    next();
  };
}

export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  scope: 'auth',
  message: { error: 'Too many authentication attempts, please try again later' },
});

export const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 240,
  scope: 'webhook',
  message: { error: 'Too many webhook requests' },
});

export const generalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  scope: 'general',
  message: { error: 'Too many requests, please try again later' },
});

export const capiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  scope: 'capi',
  message: { error: 'Too many CAPI requests' },
});
