const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { STAGE_ENUM } = require('../models/User');

function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
}

// POST /api/v1/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, instructorId, parentAccessCode, stage } = req.body;

    if (!['student', 'parent'].includes(role)) {
      return res.status(400).json({ message: 'نوع الحساب غير مسموح به عبر التسجيل الذاتي' });
    }

    if (!name || !email || !password || !instructorId) {
      return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }

    // NEW: stage is required specifically for students, validated against
    // the same enum as Course.stage so a student's stage always matches a
    // real, selectable grade — never an arbitrary free-text value.
    if (role === 'student') {
      if (!stage || !STAGE_ENUM.includes(stage)) {
        return res.status(400).json({ message: 'المرحلة الدراسية مطلوبة وغير صالحة' });
      }
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    let childId = null;

    if (role === 'parent') {
      if (!parentAccessCode) {
        return res.status(400).json({ message: 'كود ربط الطالب مطلوب' });
      }

      const student = await User.findOne({ parentAccessCode, role: 'student' });
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
      instructorId,
      childId,
      // NEW: only set for students — schema default (null) applies for
      // parents, matching the field's required-only-for-student validator.
      stage: role === 'student' ? stage : null
    });

    await user.save();

    const token = generateToken(user._id);
    res.status(201).json({ token, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const GENERIC_ERROR = { message: 'بيانات الدخول غير صحيحة' };

    if (!email || !password) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
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

exports.acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: 'كلمة المرور مطلوبة' });
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