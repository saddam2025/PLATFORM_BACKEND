const Tenant = require('../models/Tenant');
const mongoose = require('mongoose');

const LIST_FIELDS = 'name subdomain logoUrl themeColors.primary themeColors.secondary';
const DETAIL_FIELDS = `${LIST_FIELDS} tagline bio subject location coverPhotoUrl stagesOffered monthlyPrice perLecturePrice`;

function withOwnerImage(tenant) {
  if (!tenant) return null;
  const ownerAvatarUrl = tenant.ownerId?.avatarUrl || null;
  const { ownerId, ...publicTenant } = tenant;
  return {
    ...publicTenant,
    // A tenant logo takes precedence, but a teacher avatar remains a useful
    // public fallback when an admin has not configured a separate logo/cover.
    logoUrl: publicTenant.logoUrl || ownerAvatarUrl,
    coverPhotoUrl: publicTenant.coverPhotoUrl || publicTenant.logoUrl || ownerAvatarUrl
  };
}

function parsePagination(query) {
  const page = Number.parseInt(query.page, 10) || 1;
  const requestedLimit = Number.parseInt(query.limit, 10) || 12;
  return { page: Math.max(1, page), limit: Math.min(50, Math.max(1, requestedLimit)) };
}

exports.listPublicTenants = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const filter = { isActive: true, deletedAt: null };
    const [tenants, total] = await Promise.all([
      Tenant.find(filter).select(`${LIST_FIELDS} ownerId -_id`).populate('ownerId', 'avatarUrl').sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Tenant.countDocuments(filter)
    ]);
    res.json({ data: tenants.map(withOwnerImage), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

exports.getPublicTenant = async (req, res, next) => {
  try {
    const identifier = String(req.params.subdomain || '').trim().toLowerCase();
    const tenantFilter = { isActive: true, deletedAt: null };
    if (mongoose.isValidObjectId(identifier)) tenantFilter.ownerId = identifier;
    else tenantFilter.subdomain = identifier;

    const tenant = await Tenant.findOne(tenantFilter)
      .select(`${DETAIL_FIELDS} ownerId -_id`)
      .populate('ownerId', 'avatarUrl')
      .lean();
    if (!tenant) return res.status(404).json({ message: 'المنصة غير موجودة' });
    res.json({ data: withOwnerImage(tenant) });
  } catch (err) {
    next(err);
  }
};
