// DATA ISOLATION BOUNDARY — every tenant-scoped query MUST merge req.tenantFilter. Never bypass.
const tenantScope = (req, res, next) => {
  if (req.user.role === 'super_admin') {
    return next();
  }

  req.tenantFilter = { tenantId: req.user.tenantId };
  next();
};

module.exports = tenantScope;
