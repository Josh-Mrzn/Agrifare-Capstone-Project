/**
 * Without these, Express falls back to its built-in handler: an HTML page
 * carrying the full stack trace and the absolute paths of the machine serving
 * it. Two problems at once - it tells a stranger how the server is laid out,
 * and every client here parses JSON, so an HTML body arrives as "unexpected
 * response" instead of the actual reason.
 */

export function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: `No route for ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Mongoose speaks in its own error types. Left alone they all become 500s,
 * which tells the caller a bad id is the server's fault.
 */
function describe(err) {
  if (err?.name === 'CastError') {
    return { status: 404, message: 'Not found.' };
  }

  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors || {})[0];
    return { status: 400, message: first?.message || 'Some fields are invalid.' };
  }

  // Duplicate key. The index name says which field, so the message can too.
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0];
    return {
      status: 409,
      message: field
        ? `That ${field} is already taken.`
        : 'That value is already taken.',
    };
  }

  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    return { status: 401, message: 'Your session has expired. Please sign in again.' };
  }

  // Multer's own errors carry no status: too large, too many files, and so on.
  if (err?.name === 'MulterError') {
    return {
      status: 400,
      message: err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 8 MB or smaller.' : err.message,
    };
  }

  if (err?.type === 'entity.parse.failed') {
    return { status: 400, message: 'The request body is not valid JSON.' };
  }

  // AppError and other middleware set a usable status of their own.
  const own = err?.statusCode ?? err?.status;
  if (Number.isInteger(own) && own >= 400 && own < 500) {
    return { status: own, message: err.message || 'Request failed.' };
  }

  return { status: 500, message: 'Something went wrong on our end.' };
}

// eslint-disable-next-line no-unused-vars -- Express needs all four to see this as an error handler
export function errorHandler(err, req, res, next) {
  const { status, message } = describe(err);

  // The full error still reaches the server log; only what leaves the building
  // is trimmed.
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  } else {
    console.warn(`[error] ${req.method} ${req.originalUrl} -> ${status}: ${message}`);
  }

  if (res.headersSent) return next(err);

  return res.status(status).json({
    success: false,
    message,
    // A stack is useful while developing and is never sent in production.
    ...(process.env.NODE_ENV !== 'production' && status >= 500
      ? { stack: err?.stack }
      : {}),
  });
}
