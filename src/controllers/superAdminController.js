const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Course = require('../models/Course');
const Transaction = require('../models/Transaction');

const SUBSCRIPTION_STATUSES = ['active', 'suspended', 'trial'];
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getTenantCreationData(body) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, 'Request body must be an object');
  }
  const { name, subdomain, logoUrl, themeColors, subscriptionStatus, isActive } = body;
  const admin = isPlainObject(body.admin) ? body.admin : {
    name: body.adminName,
    email: body.adminEmail,
    password: body.adminPassword
  };

  if (typeof name !== 'string' || !name.trim()) {
    throw createHttpError(400, 'Tenant name is required');
  }
  if (typeof subdomain !== 'string' || !SUBDOMAIN_PATTERN.test(subdomain.trim().toLowerCase())) {
    throw createHttpError(400, 'A valid subdomain is required');
  }
  if (logoUrl !== undefined && logoUrl !== null && typeof logoUrl !== 'string') {
    throw createHttpError(400, 'logoUrl must be a string');
  }
  if (themeColors !== undefined && !isPlainObject(themeColors)) {
    throw createHttpError(400, 'themeColors must be an object');
  }
  if (themeColors && ['primary', 'secondary'].some((key) => themeColors[key] !== undefined && themeColors[key] !== null && typeof themeColors[key] !== 'string')) {
    throw createHttpError(400, 'theme color values must be strings');
  }
  if (subscriptionStatus !== undefined && !SUBSCRIPTION_STATUSES.includes(subscriptionStatus)) {
    throw createHttpError(400, 'Invalid subscription status');
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    throw createHttpError(400, 'isActive must be a boolean');
  }
  if (!admin || typeof admin.name !== 'string' || !admin.name.trim() || typeof admin.email !== 'string' || !admin.email.trim() || typeof admin.password !== 'string' || !admin.password) {
    throw createHttpError(400, 'Admin name, email, and password are required');
  }

  return {
    tenant: {
      name: name.trim(),
      subdomain: subdomain.trim().toLowerCase(),
      logoUrl: logoUrl === undefined ? null : logoUrl,
      themeColors: themeColors || undefined,
      subscriptionStatus: subscriptionStatus || undefined,
      isActive: isActive === undefined ? undefined : isActive
    },
    admin: {
      name: admin.name.trim(),
      email: admin.email.trim().toLowerCase(),
      passwordHash: admin.password
    }
  };
}

function validateTenantId(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw createHttpError(400, 'Invalid tenant id');
  }
}

function buildTenantListFilter(query) {
  const filter = { deletedAt: null };
  const { status, search } = query;

  if (status !== undefined) {
    if (typeof status !== 'string' || !SUBSCRIPTION_STATUSES.includes(status)) {
      throw createHttpError(400, 'Invalid subscription status');
    }
    filter.subscriptionStatus = status;
  }
  if (search !== undefined) {
    if (typeof search !== 'string' || search.length > 100) {
      throw createHttpError(400, 'Invalid search query');
    }
    const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escapedSearch) {
      filter.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { subdomain: { $regex: escapedSearch, $options: 'i' } }
      ];
    }
  }
  return filter;
}

function getTenantUpdateData(body) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, 'Request body must be an object');
  }
  const updates = {};
  const allowedFields = ['name', 'logoUrl', 'themeColors', 'subscriptionStatus', 'isActive'];

  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }
  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'At least one allowed field is required');
  }
  if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim())) {
    throw createHttpError(400, 'Tenant name must be a non-empty string');
  }
  if (updates.logoUrl !== undefined && updates.logoUrl !== null && typeof updates.logoUrl !== 'string') {
    throw createHttpError(400, 'logoUrl must be a string');
  }
  if (updates.themeColors !== undefined && !isPlainObject(updates.themeColors)) {
    throw createHttpError(400, 'themeColors must be an object');
  }
  if (updates.themeColors && ['primary', 'secondary'].some((key) => updates.themeColors[key] !== undefined && updates.themeColors[key] !== null && typeof updates.themeColors[key] !== 'string')) {
    throw createHttpError(400, 'theme color values must be strings');
  }
  if (updates.subscriptionStatus !== undefined && !SUBSCRIPTION_STATUSES.includes(updates.subscriptionStatus)) {
    throw createHttpError(400, 'Invalid subscription status');
  }
  if (updates.isActive !== undefined && typeof updates.isActive !== 'boolean') {
    throw createHttpError(400, 'isActive must be a boolean');
  }
  if (updates.name) updates.name = updates.name.trim();
  return updates;
}

exports.listTenants = async (req, res, next) => {
  try {
    const tenants = await Tenant.find(buildTenantListFilter(req.query)).sort({ createdAt: -1 });
    res.json({ data: tenants });
  } catch (err) {
    next(err);
  }
};

exports.createTenant = async (req, res, next) => {
  let session;
  try {
    const { tenant: tenantData, admin: adminData } = getTenantCreationData(req.body);
    session = await mongoose.startSession();
    session.startTransaction();

    const [tenant] = await Tenant.create([tenantData], { session });
    const [admin] = await User.create([{
      ...adminData,
      role: 'admin',
      tenantId: tenant._id
    }], { session });

    tenant.ownerId = admin._id;
    await tenant.save({ session });
    await session.commitTransaction();

    res.status(201).json({ data: { tenant, admin: admin.toJSON() } });
  } catch (err) {
    if (session?.inTransaction()) await session.abortTransaction();
    if (err?.code === 11000) err.statusCode = 409;
    next(err);
  } finally {
    if (session) await session.endSession();
  }
};

exports.getTenant = async (req, res, next) => {
  try {
    validateTenantId(req.params.id);
    const tenant = await Tenant.findOne({ _id: req.params.id, deletedAt: null });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    res.json({ data: tenant });
  } catch (err) {
    next(err);
  }
};

exports.updateTenant = async (req, res, next) => {
  try {
    validateTenantId(req.params.id);
    const tenant = await Tenant.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: getTenantUpdateData(req.body) },
      { new: true, runValidators: true }
    );
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    res.json({ data: tenant });
  } catch (err) {
    next(err);
  }
};

exports.deleteTenant = async (req, res, next) => {
  try {
    validateTenantId(req.params.id);
    const tenant = await Tenant.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { isActive: false, deletedAt: new Date() } },
      { new: true, timestamps: false }
    );
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    res.json({ data: tenant });
  } catch (err) {
    next(err);
  }
};

exports.getTenantStats = async (req, res, next) => {
  try {
    validateTenantId(req.params.id);
    const tenant = await Tenant.findOne({ _id: req.params.id, deletedAt: null }).select('_id');
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    const [studentCount, courseCount, transactionTotals] = await Promise.all([
      User.countDocuments({ tenantId: tenant._id, role: 'student' }),
      Course.countDocuments({ tenantId: tenant._id }),
      Transaction.aggregate([
        { $match: { tenantId: tenant._id, status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    res.json({ data: { studentCount, courseCount, successfulTransactionAmount: transactionTotals[0]?.total || 0 } });
  } catch (err) {
    next(err);
  }
};
