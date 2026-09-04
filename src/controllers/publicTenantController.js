const Tenant = require('../models/Tenant');

const LIST_FIELDS = 'name subdomain logoUrl themeColors.primary themeColors.secondary';
const DETAIL_FIELDS = `${LIST_FIELDS} tagline bio subject location coverPhotoUrl stagesOffered monthlyPrice perLecturePrice`;

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
      Tenant.find(filter).select(`${LIST_FIELDS} -_id`).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Tenant.countDocuments(filter)
    ]);
    res.json({ data: tenants, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

exports.getPublicTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.findOne({
      subdomain: String(req.params.subdomain || '').toLowerCase(), isActive: true, deletedAt: null
    }).select(`${DETAIL_FIELDS} -_id`).lean();
    if (!tenant) return res.status(404).json({ message: 'المنصة غير موجودة' });
    res.json({ data: tenant });
  } catch (err) {
    next(err);
  }
};
