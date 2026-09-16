const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { generateSecret, generateURI, verifySync } = require('otplib');
const mongoose = require('mongoose');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { STAGE_ENUM, TRACK_ENUM } = require('../models/User');
const { PASSWORD_POLICY_MESSAGE, hasValidPassword } = require('../utils/passwordPolicy');
const { uploadImageFile, validateR2File } = require('../utils/r2Upload');

const TRACK_STAGE_IDS = new Set(['grade-10', 'baccalaureate-1', 'baccalaureate-2', 'grade-11', 'grade-12']);

function normalizePhone(value) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return String(value || '')
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[^\d+]/g, '');
}

function generateToken(userId) {
  return jwt.sign({ id: userId, type: 'session' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

const MFA_ROLES = ['admin', 'assistant', 'super_admin'];
const MFA_ISSUER = 'LMS Platform';
const MFA_PENDING_LOGIN_EXPIRES_IN = process.env.MFA_PENDING_LOGIN_EXPIRES_IN || '5m';

function isMfaEligible(user) {
  return user && MFA_ROLES.includes(user.role);
}

function verifyTotp(token, secret) {
  // Accept one 30-second interval on either side of the server clock. This is
  // a deliberately small, standard TOTP drift allowance.
  return typeof token === 'string'
    && /^\d{6}$/.test(token)
    && verifySync({ secret, token, epochTolerance: 30 }).valid;
}

function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(4).toString('hex').toUpperCase());
}

function normalizeBackupCode(code) {
  return typeof code === 'string' ? code.replace(/[^a-z0-9]/gi, '').toUpperCase() : '';
}

function createPendingLoginToken(userId) {
  // Deliberately contains only an id and a distinct type; no role or tenant
  // claims are carried, and protect() rejects this type everywhere.
  return jwt.sign({ id: userId, type: 'mfa_pending' }, process.env.JWT_SECRET, {
    expiresIn: MFA_PENDING_LOGIN_EXPIRES_IN
  });
}

// POST /api/v1/auth/register
exports.register = async (req, res, next) => {
  let session;
  try {
    const { name, email, password, role, instructorId, parentAccessCode, stage, track, phone, fatherPhone, motherPhone } = req.body;

    if (!['student', 'parent'].includes(role)) {
      return res.status(400).json({ message: 'نوع الحساب غير مسموح به عبر التسجيل الذاتي' });
    }

    if (!name || !email || !password || !instructorId) {
      return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }
    if (!hasValidPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
    }

    // A token is part of a successful self-registration response. Fail before
    // writing anything when this required server configuration is absent.
    if (!process.env.JWT_SECRET) {
      return res.status(503).json({ message: 'التسجيل غير متاح مؤقتًا. يرجى المحاولة لاحقًا.' });
    }

    // NEW: stage is required specifically for students, validated against
    // the same enum as Course.stage so a student's stage always matches a
    // real, selectable grade — never an arbitrary free-text value.
    if (role === 'student') {
      if (!stage || !STAGE_ENUM.includes(stage)) {
        return res.status(400).json({ message: 'المرحلة الدراسية مطلوبة وغير صالحة' });
      }
      if (TRACK_STAGE_IDS.has(stage) && !TRACK_ENUM.includes(track)) {
        return res.status(400).json({ message: 'الشعبة مطلوبة وغير صالحة لهذه المرحلة' });
      }
      if (!TRACK_STAGE_IDS.has(stage) && track != null && track !== '') {
        return res.status(400).json({ message: 'الشعبة غير متاحة لهذه المرحلة' });
      }
      if (!phone || !String(phone).trim() || !fatherPhone || !String(fatherPhone).trim() || !motherPhone || !String(motherPhone).trim()) {
        return res.status(400).json({ message: 'أرقام هاتف الطالب والأب والأم مطلوبة' });
      }
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    let childId = null;
    // Public registration routes use a tenant subdomain (for example
    // /math/register), while legacy clients submit the admin ObjectId. Resolve
    // either form to the tenant's active owner before assigning a student.
    let instructor;
    if (mongoose.isValidObjectId(instructorId)) {
      instructor = await User.findOne({ _id: instructorId, role: 'admin', isActive: true }).select('tenantId');
    } else {
      const tenant = await Tenant.findOne({
        subdomain: String(instructorId).trim().toLowerCase(),
        isActive: true,
        deletedAt: null
      }).select('ownerId');
      if (tenant?.ownerId) {
        instructor = await User.findOne({ _id: tenant.ownerId, role: 'admin', isActive: true }).select('tenantId');
      }
    }
    if (!instructor || !instructor.tenantId) {
      return res.status(400).json({ message: 'المدرس غير موجود أو غير نشط' });
    }

    if (role === 'parent') {
      if (!parentAccessCode) {
        return res.status(400).json({ message: 'كود ربط الطالب مطلوب' });
      }

      const student = await User.findOne({ parentAccessCode, role: 'student', tenantId: instructor.tenantId, instructorId: instructor._id });
      if (!student) {
        return res.status(400).json({ message: 'كود ربط غير صالح' });
      }
      childId = student._id;
    }

    const user = new User({
      name,
      email: email.toLowerCase(),
      passwordHash: password,
      role,
      tenantId: instructor.tenantId,
      instructorId: instructor._id,
      childId,
      // NEW: only set for students — schema default (null) applies for
      // parents, matching the field's required-only-for-student validator.
      stage: role === 'student' ? stage : null,
      track: role === 'student' && TRACK_STAGE_IDS.has(stage) ? track : null,
      phone: role === 'student' ? normalizePhone(phone) : '',
      fatherPhone: role === 'student' ? String(fatherPhone).trim() : '',
      motherPhone: role === 'student' ? String(motherPhone).trim() : ''
    });

    // Keep the persisted account and its required session credential atomic.
    // Although signing normally cannot fail once JWT_SECRET is present, doing
    // it before commit guarantees that a future change in this flow cannot
    // report failure after the user document has been committed.
    session = await mongoose.startSession();
    session.startTransaction();
    await user.save({ session });
    const token = generateToken(user._id);
    await session.commitTransaction();
    res.status(201).json({ token, user: user.toJSON() });
  } catch (err) {
    if (session?.inTransaction()) await session.abortTransaction();
    if (err?.code === 11000) {
      err.statusCode = 409;
      err.message = 'البريد الإلكتروني مستخدم بالفعل';
    }
    next(err);
  } finally {
    if (session) await session.endSession();
  }
};

// POST /api/v1/auth/login
exports.login = async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    const GENERIC_ERROR = { message: 'قد يكون هناك خطأ في البريد الإلكتروني أو كلمة المرور، أعد المحاولة' };

    if (!identifier || !password) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const normalizedIdentifier = String(identifier).trim();
    const isEmail = normalizedIdentifier.includes('@');
    const query = isEmail
      ? { email: normalizedIdentifier.toLowerCase() }
      : { phone: normalizePhone(normalizedIdentifier) };
    const user = await User.findOne(query).select('+passwordHash');
    
    console.log(1, { identifier, password }, query, user);
    if (!user) {
      return res.status(401).json(GENERIC_ERROR);
    }

    if (!user.isActive) {
      return res.status(401).json(GENERIC_ERROR);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json(GENERIC_ERROR);
    }

    if (user.mfaEnabled) {
      return res.json({
        mfaRequired: true,
        pendingLoginToken: createPendingLoginToken(user._id),
        expiresIn: MFA_PENDING_LOGIN_EXPIRES_IN
      });
    }

    const token = generateToken(user._id);
    res.json({ token, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res) => {
  res.json({ data: req.user });
};

exports.logout = async (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'تم تسجيل الخروج' });
};

// POST /api/v1/auth/mfa/setup
exports.setupMfa = async (req, res, next) => {
  try {
    if (!isMfaEligible(req.user)) return res.status(403).json({ message: 'MFA is not available for this role' });

    const user = await User.findById(req.user._id).select('+mfaSecret +mfaBackupCodes');
    if (!user) return res.status(401).json({ message: 'Not authorized, user not found' });
    if (user.mfaEnabled) return res.status(409).json({ message: 'MFA is already enabled. Disable it before setting up a new authenticator.' });

    const secret = generateSecret();
    const accountLabel = user.role === 'super_admin'
      ? `Platform Super Admin (${user.email})`
      : user.email;
    user.mfaSecret = secret;
    user.mfaBackupCodes = [];
    await user.save();

    return res.json({
      data: {
        secret,
        otpauthUri: generateURI({ issuer: MFA_ISSUER, label: accountLabel, secret })
      }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/mfa/confirm
exports.confirmMfa = async (req, res, next) => {
  try {
    if (!isMfaEligible(req.user)) return res.status(403).json({ message: 'MFA is not available for this role' });
    const { code } = req.body;
    const user = await User.findById(req.user._id).select('+mfaSecret +mfaBackupCodes');
    if (user?.mfaEnabled) return res.status(409).json({ message: 'MFA is already enabled' });
    if (!user?.mfaSecret || !verifyTotp(code, user.mfaSecret)) {
      return res.status(400).json({ message: 'Invalid authentication code' });
    }

    const backupCodes = generateBackupCodes();
    user.mfaBackupCodes = await Promise.all(backupCodes.map((backupCode) => bcrypt.hash(backupCode, 12)));
    user.mfaEnabled = true;
    await user.save();
    return res.json({ data: { mfaEnabled: true, backupCodes } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/mfa/disable
exports.disableMfa = async (req, res, next) => {
  try {
    if (!isMfaEligible(req.user)) return res.status(403).json({ message: 'MFA is not available for this role' });
    const { password, code } = req.body;
    if (!password || !code) return res.status(400).json({ message: 'Current password and authentication code are required' });

    const user = await User.findById(req.user._id).select('+passwordHash +mfaSecret +mfaBackupCodes');
    if (!user?.mfaEnabled || !user.mfaSecret || !(await user.comparePassword(password)) || !verifyTotp(code, user.mfaSecret)) {
      return res.status(401).json({ message: 'Password or authentication code is invalid' });
    }
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaBackupCodes = [];
    await user.save();
    return res.json({ data: { mfaEnabled: false } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/mfa/verify-login
exports.verifyMfaLogin = async (req, res, next) => {
  const GENERIC_ERROR = { message: 'Invalid or expired MFA verification attempt' };
  try {
    const { pendingLoginToken, code, backupCode } = req.body;
    if (!pendingLoginToken || (!code && !backupCode)) return res.status(401).json(GENERIC_ERROR);

    let pending;
    try {
      pending = jwt.verify(pendingLoginToken, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(401).json(GENERIC_ERROR);
    }
    if (pending.type !== 'mfa_pending' || !pending.id) return res.status(401).json(GENERIC_ERROR);

    const user = await User.findById(pending.id).select('+mfaSecret +mfaBackupCodes');
    if (!user || !user.isActive || user.deletedAt || user.inviteStatus === 'pending' || !isMfaEligible(user) || !user.mfaEnabled || !user.mfaSecret) {
      return res.status(401).json(GENERIC_ERROR);
    }

    let valid = verifyTotp(code, user.mfaSecret);
    if (!valid && backupCode) {
      const normalized = normalizeBackupCode(backupCode);
      const matchingHash = normalized && (await Promise.all(user.mfaBackupCodes.map(async (hash) => (await bcrypt.compare(normalized, hash)) ? hash : null))).find(Boolean);
      if (matchingHash) {
        // Atomic conditional removal makes a recovery code single-use even if
        // two verification requests race each other.
        const result = await User.updateOne(
          { _id: user._id, mfaBackupCodes: matchingHash },
          { $pull: { mfaBackupCodes: matchingHash } }
        );
        valid = result.modifiedCount === 1;
      }
    }
    if (!valid) return res.status(401).json(GENERIC_ERROR);

    return res.json({ token: generateToken(user._id), user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/auth/me/avatar
exports.updateMyAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Avatar image is required' });
    }

    validateR2File(req.file, ['image/jpeg', 'image/png', 'image/webp'], 3 * 1024 * 1024, 'Avatar image');

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }

    user.avatarUrl = await uploadImageFile(req.file, 'avatars', 'Avatar image');
    await user.save();

    res.json({ data: { avatarUrl: user.avatarUrl } });
  } catch (err) {
    next(err);
  }
};

exports.acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'كلمة المرور مطلوبة' });
    }
    if (!hasValidPassword(password)) {
      return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
    }

    const user = await User.findOne({ inviteToken: token, inviteStatus: 'pending' }).select('+inviteToken');
    if (!user) {
      return res.status(400).json({ message: 'رابط الدعوة غير صالح أو تم استخدامه بالفعل' });
    }

    user.passwordHash = password;
    user.inviteStatus = 'active';
    user.inviteToken = undefined;
    await user.save();

    const jwtToken = generateToken(user._id);
    res.json({ token: jwtToken, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};
