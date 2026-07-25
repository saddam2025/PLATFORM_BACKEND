// Centralized error handler. Must be registered LAST in server.js (after all
// routes) so any next(err) call anywhere in the app funnels through here.
// OWASP A09 (Security Logging and Monitoring Failures) — errors are logged
// server-side always, but the response body never leaks stack traces or
// internal details in production.
function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Log full error server-side regardless of environment.
  console.error(`[ERROR] ${req.method} ${req.originalUrl} -`, err);

  const response = { message, status };

  // Never leak stack traces to the client in production (OWASP A09).
  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(status).json(response);
}

module.exports = errorHandler;