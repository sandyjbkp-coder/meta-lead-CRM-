// Central error handler for express
export function errorHandler(err, req, res, next) {
  // Known custom errors (AppError from utils/errorCodes)
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  // Zod validation errors
  if (err.name === 'ZodError' || (err.issues && Array.isArray(err.issues))) {
    const details = err.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    return res.status(400).json({ error: 'Validation failed', details });
  }

  // Duplicate entry
  if (err.message && err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'Duplicate entry' });
  }

  // JWT / auth errors
  if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Authentication failed: ' + err.message });
  }

  // Generic 500
  console.error('[ERR] Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
