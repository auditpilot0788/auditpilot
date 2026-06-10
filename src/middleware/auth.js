/**
 * AuditPilot — Auth Middleware
 * Verifies the JWT from the Authorization header or the 'auditpilot_token' cookie.
 * Attaches the decoded payload to req.user on success.
 */

const jwt = require('jsonwebtoken');

/**
 * Protects a route by requiring a valid JWT.
 * Token is read from (in priority order):
 *   1. Authorization: Bearer <token>  header
 *   2. auditpilot_token               httpOnly cookie
 */
function requireAuth(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies && req.cookies.auditpilot_token) {
    token = req.cookies.auditpilot_token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not set.');
    return res.status(500).json({ error: 'Server misconfiguration.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Session expired. Please log in again.'
      : 'Invalid token. Please log in again.';
    return res.status(401).json({ error: message });
  }
}

/**
 * Reads a JWT if one is present but never blocks the request.
 * Sets req.user to the decoded payload on success, null otherwise.
 * Use this on routes that serve both authenticated and anonymous users.
 */
function optionalAuth(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies && req.cookies.auditpilot_token) {
    token = req.cookies.auditpilot_token;
  }

  if (!token || !process.env.JWT_SECRET) {
    req.user = null;
    return next();
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    req.user = null; // expired or invalid — treat as anonymous
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
