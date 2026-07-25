const crypto = require('crypto');
const User = require('../models/User');

// POST /api/v1/instructors/:instructorId/assistants
// protect + authorize('admin') applied at the route level.
// OWASP A01 (BOLA) — an admin may only invite assistants into their OWN
// tenant. req.user._id is compared against the :instructorId URL param;
// an admin cannot pass someone else's id and invite into their tenant.
exports.createAssistant = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { name, email, permissions } = req.body;

    if (String(req.user._id) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بإضافة مساعدين لهذا الحساب' });
    }

    if (!name || !email) {
      return res.status(400).json({ message: 'الاسم والبريد الإلكتروني مطلوبان' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const inviteToken = crypto.randomBytes(24).toString('hex');

    const assistant = new User({
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

    if (String(req.user._id) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض مساعدي هذا الحساب' });
    }

    const assistants = await User.find({ instructorId, role: 'assistant' });
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

    if (String(req.user._id) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل مساعدي هذا الحساب' });
    }

    // BOLA check on the target resource itself: the assistant being updated
    // must actually belong to this instructor's tenant, not just any user id.
    const assistant = await User.findOne({ _id: assistantId, instructorId, role: 'assistant' });
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