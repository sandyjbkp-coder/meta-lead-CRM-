import { ZodError } from 'zod';

// Wrapper for zod validation
export function validate(schema) {
  return (req, res, next) => {
    let result = { success: true, data: req.body || {} };

    try {
      // Zod v3: safeParse
      result = schema.safeParse(req.body || {});
      if (!result.success) {
        const details = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        const err = new Error(`Validation failed: ${details}`);
        err.name = 'ZodError';
        err.statusCode = 400;
        throw err;
      }
    } catch (err) {
      if (err.name === 'ZodError') return next(err);
      // Otherwise continue
      return next();
    }

    if (result.success) {
      req.body = result.data;
      req.validated = true;
    }
    return next();
  };
}
