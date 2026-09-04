const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

function ownsInstructor(req, instructorId) {
  return req.user.role === 'super_admin' || String(req.user._id) === String(instructorId);
}

async function findManagedAssistant(req, instructorId, assistantId) {
  if (!mongoose.isValidObjectId(assistantId)) return null;
  return User.findOne({
    _id: assistantId,
    instructorId,
    role: 'assistant',
    deletedAt: null,
    ...req.tenantFilter
  });
}

// POST /api/v1/instructors/:instructorId/assistants
// protect + authorize('admin') applied at the route level.
// OWASP A01 (BOLA) — an admin may only invite assistants into their OWN
// tenant. req.user._id is compared against the :instructorId URL param;
// an admin cannot pass someone else's id and invite into their tenant.
exports.createAssistant = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { name, email, permissions } = req.body;

    if (!ownsInstructor(req, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بإضافة مساعدين لهذا الحساب' });
    }

    if (!name || !email) {
      return res.status(400).json({ message: 'الاسم والبريد الإلكتروني مطلوبان' });
    }

    const instructor = await User.findOne({ _id: instructorId, role: 'admin', ...req.tenantFilter }).select('tenantId');
    if (!instructor?.tenantId) {
      return res.status(404).json({ message: 'المدرس غير موجود' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');

    const assistant = new User({
      tenantId: instructor.tenantId,
      name,
      email: email.toLowerCase(),
      // No password yet — set only via accept-invite. A random placeholder
      // is required to satisfy the schema's required passwordHash field and
      // pre-save hashing hook; it is unusable since inviteStatus stays
      // 'pending' and login/protect both reject pending accounts.
      passwordHash: crypto.randomBytes(32).toString('hex'),
      role: 'assistant',
      instructorId,
      permissions: Array.isArray(permissions) ? permissions : [],
      inviteStatus: 'pending',
      inviteToken
    });

    await assistant.save();

    const inviteLink = `${process.env.FRONTEND_URL}/accept-invite/${inviteToken}`;

    res.status(201).json({ assistant: assistant.toJSON(), inviteLink });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/assistants
// protect + authorize('admin'), same ownership check as createAssistant.
exports.listAssistants = async (req, res, next) => {
  try {
    const { instructorId } = req.params;

    if (!ownsInstructor(req, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض مساعدي هذا الحساب' });
    }

    const assistants = await User.find({ instructorId, role: 'assistant', deletedAt: null, ...req.tenantFilter });
    res.json({ data: assistants });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/instructors/:instructorId/assistants/:assistantId
// protect + authorize('admin'), same ownership check — updates permissions only.
exports.updateAssistantPermissions = async (req, res, next) => {
  try {
    const { instructorId, assistantId } = req.params;
    const { permissions } = req.body;

    if (!ownsInstructor(req, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل مساعدي هذا الحساب' });
    }

    // BOLA check on the target resource itself: the assistant being updated
    // must actually belong to this instructor's tenant, not just any user id.
    const assistant = await findManagedAssistant(req, instructorId, assistantId);
    if (!assistant) {
      return res.status(404).json({ message: 'المساعد غير موجود' });
    }

    if (Array.isArray(permissions)) {
      assistant.permissions = permissions;
      await assistant.save();
    }

    res.json({ data: assistant.toJSON() });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/instructors/:instructorId/assistants/:assistantId/suspend
exports.suspendAssistant = async (req, res, next) => {
  try {
    const { instructorId, assistantId } = req.params;
    if (!ownsInstructor(req, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتعليق مساعدي هذا الحساب' });
    }
    const assistant = await findManagedAssistant(req, instructorId, assistantId);
    if (!assistant) return res.status(404).json({ message: 'المساعد غير موجود' });

    assistant.isActive = false;
    await assistant.save();
    res.json({ data: assistant.toJSON() });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/instructors/:instructorId/assistants/:assistantId/reactivate
exports.reactivateAssistant = async (req, res, next) => {
  try {
    const { instructorId, assistantId } = req.params;
    if (!ownsInstructor(req, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بإعادة تفعيل مساعدي هذا الحساب' });
    }
    const assistant = await findManagedAssistant(req, instructorId, assistantId);
    if (!assistant) return res.status(404).json({ message: 'المساعد غير موجود' });

    assistant.isActive = true;
    await assistant.save();
    res.json({ data: assistant.toJSON() });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/instructors/:instructorId/assistants/:assistantId
// Soft delete retains audit/relationship data while removing the assistant
// from management lists and blocking both future login and existing tokens.
exports.deleteAssistant = async (req, res, next) => {
  try {
    const { instructorId, assistantId } = req.params;
    if (!ownsInstructor(req, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بحذف مساعدي هذا الحساب' });
    }
    const assistant = await findManagedAssistant(req, instructorId, assistantId);
    if (!assistant) return res.status(404).json({ message: 'المساعد غير موجود' });

    assistant.isActive = false;
    assistant.deletedAt = new Date();
    await assistant.save();
    res.json({ data: { _id: assistant._id, isActive: assistant.isActive, deletedAt: assistant.deletedAt, deleted: true } });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:id/assistant-profile
// protect + tenantScope + authorize('parent', 'admin') at route level.
// The first lookup deliberately fetches only authorization metadata. It lets
// us reject a cross-tenant target before querying any profile fields.
exports.getAssistantProfile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const targetUser = await User.findById(id).select('tenantId role instructorId');
    // Match student-profile's anti-enumeration behavior: a target outside
    // the caller's tenant is indistinguishable from an unknown assistant.
    if (!targetUser || String(targetUser.tenantId) !== String(req.user.tenantId)) {
      return res.status(404).json({ message: 'المساعد غير موجود' });
    }

    if (targetUser.role !== 'assistant') {
      return res.status(404).json({ message: 'المساعد غير موجود' });
    }

    // A parent may view only an assistant assigned to their own child’s
    // instructor. An admin is already limited to their tenant above.
    if (req.user.role === 'parent') {
      const child = await User.findOne({
        _id: req.user.childId,
        role: 'student',
        ...req.tenantFilter
      }).select('instructorId');

      if (!child || String(child.instructorId) !== String(targetUser.instructorId)) {
        return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا المساعد' });
      }
    }

    // Deliberately projection-only: no email, phone, permissions, tokens,
    // payment credentials, or other personal/account fields are fetched.
    const assistant = await User.findOne({
      _id: targetUser._id,
      role: 'assistant',
      deletedAt: null,
      ...req.tenantFilter
    }).select('name avatarUrl role bio -_id');

    if (!assistant) {
      return res.status(404).json({ message: 'المساعد غير موجود' });
    }

    res.json({ data: assistant });
  } catch (err) {
    next(err);
  }
};
