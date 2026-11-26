export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  WEBHOOK_ERROR: 'WEBHOOK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
};

export class AppError extends Error {
  constructor(statusCode, message, code = ERROR_CODES.INTERNAL_ERROR) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export const errors = {
  unauthorized: (message = 'Unauthorized') => new AppError(401, message, ERROR_CODES.UNAUTHORIZED),
  forbidden: (message = 'Forbidden') => new AppError(403, message, ERROR_CODES.FORBIDDEN),
  notFound: (message = 'Not found') => new AppError(404, message, ERROR_CODES.NOT_FOUND),
  validation: (message = 'Validation error') => new AppError(400, message, ERROR_CODES.VALIDATION_ERROR),
  conflict: (message = 'Conflict') => new AppError(409, message, ERROR_CODES.CONFLICT),
  internal: (message = 'Internal error') => new AppError(500, message, ERROR_CODES.INTERNAL_ERROR),
  webhookError: (message = 'Webhook error') => new AppError(400, message, ERROR_CODES.WEBHOOK_ERROR),
};
