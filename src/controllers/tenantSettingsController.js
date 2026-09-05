const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getOwnedTenant(req) {
  const { instructorId } = req.params;
  if (!mongoose.isValidObjectId(instructorId)) throw createHttpError(400, 'معرف المدرس غير صالح');
  // Both checks are intentional: URL ownership prevents BOLA via another
  // admin's id, while ownerId prevents a forged/stale tenant association.
  if (String(req.user._id) !== String(instructorId)) return null;
  return Tenant.findOne({ _id: req.user.tenantId, ownerId: req.user._id, deletedAt: null });
}

function settingsResponse(tenant, admin) {
  return {
    tenant,
    gateway: {
      paymobIntegrationId: admin.paymobIntegrationId || '',
      paymobApiKeyConfigured: Boolean(admin.paymobApiKey)
    }
  };
}

function getSettingsUpdateData(body) {
  if (!isPlainObject(body)) throw createHttpError(400, 'بيانات الطلب غير صالحة');
  const tenantUpdates = {};
  const tenantFields = ['name', 'logoUrl', 'supportPhone', 'supportEmail', 'themeColors', 'videoDelivery', 'documentDelivery', 'notificationPreferences'];
  for (const field of tenantFields) {
    if (body[field] !== undefined) tenantUpdates[field] = body[field];
  }
  const adminUpdates = {};
  if (body.paymobIntegrationId !== undefined) adminUpdates.paymobIntegrationId = body.paymobIntegrationId;
  if (body.paymobApiKey !== undefined) adminUpdates.paymobApiKey = body.paymobApiKey;
  if (!Object.keys(tenantUpdates).length && !Object.keys(adminUpdates).length) throw createHttpError(400, 'يلزم إرسال حقل إعداد واحد على الأقل');

  if (tenantUpdates.name !== undefined && (typeof tenantUpdates.name !== 'string' || !tenantUpdates.name.trim())) throw createHttpError(400, 'اسم المنصة غير صالح');
  if (tenantUpdates.logoUrl !== undefined && tenantUpdates.logoUrl !== null && typeof tenantUpdates.logoUrl !== 'string') throw createHttpError(400, 'رابط الشعار غير صالح');
  for (const field of ['supportPhone', 'supportEmail']) {
    if (tenantUpdates[field] !== undefined && (typeof tenantUpdates[field] !== 'string' || tenantUpdates[field].length > 200)) throw createHttpError(400, `${field} غير صالح`);
  }
  if (tenantUpdates.themeColors !== undefined && (!isPlainObject(tenantUpdates.themeColors) || ['primary', 'secondary'].some((key) => tenantUpdates.themeColors[key] !== undefined && tenantUpdates.themeColors[key] !== null && typeof tenantUpdates.themeColors[key] !== 'string'))) throw createHttpError(400, 'ألوان الهوية غير صالحة');
  if (tenantUpdates.videoDelivery !== undefined) {
    const video = tenantUpdates.videoDelivery;
    if (!isPlainObject(video) || (video.provider !== undefined && typeof video.provider !== 'string') || (video.pullZone !== undefined && typeof video.pullZone !== 'string') || (video.maxViewsPerLesson !== undefined && (!Number.isInteger(video.maxViewsPerLesson) || video.maxViewsPerLesson < 1 || video.maxViewsPerLesson > 1000)) || (video.accessWindowDays !== undefined && (!Number.isInteger(video.accessWindowDays) || video.accessWindowDays < 1 || video.accessWindowDays > 3650))) throw createHttpError(400, 'قواعد الفيديو غير صالحة');
  }
  if (tenantUpdates.documentDelivery !== undefined) {
    const documents = tenantUpdates.documentDelivery;
    if (!isPlainObject(documents) || (documents.provider !== undefined && (typeof documents.provider !== 'string' || documents.provider.length > 100)) || (documents.publicBaseUrl !== undefined && (typeof documents.publicBaseUrl !== 'string' || documents.publicBaseUrl.length > 2000))) throw createHttpError(400, 'إعدادات المستندات غير صالحة');
  }
  if (tenantUpdates.notificationPreferences !== undefined) {
    const notifications = tenantUpdates.notificationPreferences;
    if (!isPlainObject(notifications) || ['smsEnabled', 'emailEnabled', 'whatsappEnabled'].some((key) => notifications[key] !== undefined && typeof notifications[key] !== 'boolean')) throw createHttpError(400, 'تفضيلات الإشعارات غير صالحة');
  }
  for (const field of ['paymobIntegrationId', 'paymobApiKey']) {
    if (adminUpdates[field] !== undefined && (typeof adminUpdates[field] !== 'string' || adminUpdates[field].length > 500)) throw createHttpError(400, 'إعدادات Paymob غير صالحة');
  }
  if (tenantUpdates.name) tenantUpdates.name = tenantUpdates.name.trim();
  return { tenantUpdates, adminUpdates };
}

exports.getOwnTenantSettings = async (req, res, next) => {
  try {
    const tenant = await getOwnedTenant(req);
    if (!tenant) return res.status(403).json({ message: 'غير مصرح لك بعرض إعدادات مؤسسة أخرى' });
    const admin = await User.findOne({ _id: req.user._id, tenantId: tenant._id, role: 'admin' }).select('+paymobApiKey paymobIntegrationId');
    if (!admin) return res.status(403).json({ message: 'حساب المدير غير صالح لهذه المؤسسة' });
    res.json({ data: settingsResponse(tenant, admin) });
  } catch (err) {
    next(err);
  }
};

exports.updateOwnTenantSettings = async (req, res, next) => {
  try {
    const tenant = await getOwnedTenant(req);
    if (!tenant) return res.status(403).json({ message: 'غير مصرح لك بتعديل إعدادات مؤسسة أخرى' });
    const { tenantUpdates, adminUpdates } = getSettingsUpdateData(req.body);
    if (Object.keys(tenantUpdates).length) {
      Object.assign(tenant, tenantUpdates);
      await tenant.save();
    }
    const admin = await User.findOne({ _id: req.user._id, tenantId: tenant._id, role: 'admin' }).select('+paymobApiKey paymobIntegrationId');
    if (!admin) return res.status(403).json({ message: 'حساب المدير غير صالح لهذه المؤسسة' });
    if (Object.keys(adminUpdates).length) {
      Object.assign(admin, adminUpdates);
      await admin.save();
    }
    res.json({ data: settingsResponse(tenant, admin) });
  } catch (err) {
    next(err);
  }
};
