const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies the Bearer JWT, loads the user, and attaches it to req.user.
// OWASP A02 (Cryptographic Failures) — passwordHash is explicitly excluded
// from every query here via .select('-passwordHash'); no controller should
// ever need to re-select it for a response.
const protect = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('-passwordHash');

    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }

    if (!user.isActive || user.deletedAt || user.inviteStatus === 'pending') {
      // Assistant accounts created via invite but not yet activated
      // (password not set) must never be allowed to authenticate.
      return res.status(401).json({ message: 'Account not active' });
    }

    req.user = user;
    next();
  } catch (err) {
    // Covers jwt.verify failures (expired/invalid/tampered token) uniformly —
    // no distinction given to the client between "expired" and "invalid" to
    // avoid leaking verification internals (OWASP A02/A07).
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// Public catalogue/detail endpoints can attach a user when a valid token is
// present while still allowing visitors to see public data. A supplied invalid
// token continues through protect(), which returns the normal 401 response.
const optionalProtect = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();
  return protect(req, res, next);
};

// OWASP A01 (Broken Access Control) — every protected route in this app must
// use authorize(...) explicitly. There is no "default allow" path; a route
// with no authorize() call still requires protect() to pass, but any
// role-specific route MUST wrap with this.
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== 'super_admin' && !roles.includes(req.user.role))) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }
    next();
  };
};

// Granular permission check for assistants (admins always bypass).
// Mirrors the requirePermission behavior already assumed by the frontend
// (TenantSettingsPage.jsx assistant permission checkboxes, CourseEditorPage.jsx
// video-upload gating, AssignmentGradingPage.jsx grading gate).
const requirePermission = (permissionName) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (req.user.role === 'super_admin' || req.user.role === 'admin') {
      return next();
    }
    if (req.user.role === 'assistant' && Array.isArray(req.user.permissions) && req.user.permissions.includes(permissionName)) {
      return next();
    }
    return res.status(403).json({ message: 'Insufficient permissions' });
  };
};

module.exports = { protect, optionalProtect, authorize, requirePermission };
