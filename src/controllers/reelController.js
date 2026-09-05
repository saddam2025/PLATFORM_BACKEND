const Reel = require('../models/Reel');
const Subscription = require('../models/Subscription');
const LectureAccess = require('../models/LectureAccess');
const Course = require('../models/Course');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const mongoose = require('mongoose');
const createNotificationsForAudience = require('../utils/createNotification');

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

// Public student URLs use the tenant subdomain (for example, "sohag"), while
// Reel.instructorId stores the tenant owner's ObjectId. Resolve either route
// form before using it in a Mongoose query.
async function resolveInstructorTenant(instructorIdentifier) {
  if (mongoose.isValidObjectId(instructorIdentifier)) {
    const instructor = await User.findOne({ _id: instructorIdentifier, role: 'admin', isActive: true })
      .select('_id tenantId')
      .lean();
    if (instructor?.tenantId) return { instructorId: instructor._id, tenantId: instructor.tenantId };
  }

  const tenant = await Tenant.findOne({
    subdomain: String(instructorIdentifier).trim().toLowerCase(),
    isActive: true,
    deletedAt: null
  }).select('_id ownerId').lean();
  return tenant?.ownerId ? { instructorId: tenant.ownerId, tenantId: tenant._id } : null;
}

function parsePagination(query) {
  const parsePositiveInteger = (value, name, defaultValue, max) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      return { error: `${name} يجب أن يكون عدداً صحيحاً موجباً` };
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || (max && parsed > max)) {
      return { error: max ? `${name} يجب ألا يتجاوز ${max}` : `${name} غير صالح` };
    }
    return parsed;
  };

  const page = parsePositiveInteger(query.page, 'page', 1);
  const limit = parsePositiveInteger(query.limit, 'limit', 20, 50);
  if (typeof page === 'object' || typeof limit === 'object') {
    return { error: page.error || limit.error };
  }
  return { page, limit };
}

// POST /api/v1/instructors/:instructorId/reels
// protect + authorize('admin','assistant') + requirePermission('can_upload_video')
// for assistants (applied at route level, reusing the exact same permission
// from B2/B3 — feature #15 requires identical upload permissions, so no new
// permission flag is introduced here).
exports.createReel = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { caption, stage } = req.body;

    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك برفع ريلز لهذا الحساب' });
    }

    const videoUrl = req.files?.video?.[0]
      ? `/uploads/videos/${req.files.video[0].filename}`
      : req.file
      ? `/uploads/videos/${req.file.filename}`
      : null;

    if (!videoUrl) {
      return res.status(400).json({ message: 'ملف الفيديو مطلوب' });
    }

    const reel = await Reel.create({
      tenantId: req.user.tenantId,
      instructorId,
      uploadedBy: req.user._id,
      videoUrl,
      caption: caption || '',
      stage: stage || null
    });

    // CROSS-BATCH WIRE-UP: notify students (and per feature #13, parents too,
    // since a new reel is content-adjacent the same way a new course is)
    // whenever a reel is uploaded.
    await createNotificationsForAudience({
      tenantId: req.user.tenantId,
      instructorId,
      type: 'new_reel',
      title: 'ريلز جديد',
      body: caption || 'تم نشر مقطع فيديو قصير جديد',
      relatedId: reel._id,
      audience: 'both'
    });

    res.status(201).json({ data: reel });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/reels
// protect + authorize('student', 'admin', 'assistant').
// CRITICAL access check per feature #8: being registered under an
// instructorId is NOT the same as being subscribed. A student must have at
// least one active Subscription OR LectureAccess record tied to this
// instructor before any reels are returned — otherwise 403, distinct from
// an empty array, so the frontend can tell "no reels yet" apart from
// "you're not subscribed."
exports.listReels = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { page, limit, error } = parsePagination(req.query);
    if (error) return res.status(400).json({ message: error });

    const instructor = await resolveInstructorTenant(instructorId);
    if (!instructor || String(instructor.tenantId) !== String(req.user.tenantId)) {
      return res.status(404).json({ message: 'المدرس غير موجود' });
    }
    const resolvedInstructorId = instructor.instructorId;

    // Management users get the complete tenant-scoped list for the instructor
    // they own/work for. Student access deliberately retains its subscription
    // or lecture-access gate below.
    if (req.user.role === 'admin' || req.user.role === 'assistant') {
      if (!isOwnerOfInstructor(req.user, resolvedInstructorId)) {
        return res.status(403).json({ message: 'غير مصرح لك بعرض ريلز هذا الحساب' });
      }

      const filter = { instructorId: resolvedInstructorId, ...req.tenantFilter };
      const [reels, total] = await Promise.all([
        Reel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
        Reel.countDocuments(filter)
      ]);
      return res.json({ data: reels, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    }

    const hasSubscription = await Subscription.exists({
      studentId: req.user._id,
      instructorId: resolvedInstructorId,
      status: 'active',
      ...req.tenantFilter
    });

    let hasLectureAccess = false;
    if (!hasSubscription) {
      // LectureAccess doesn't store instructorId directly — it's scoped by
      // courseId, so we check whether the student has any LectureAccess
      // record for a course belonging to this instructor.
      const instructorCourseIds = await Course.find({ instructorId: resolvedInstructorId, ...req.tenantFilter }).select('_id').lean();
      const courseIds = instructorCourseIds.map((c) => c._id);
      hasLectureAccess = await LectureAccess.exists({
        studentId: req.user._id,
        courseId: { $in: courseIds },
        expiresAt: { $gt: new Date() },
        ...req.tenantFilter
      });
    }

    if (!hasSubscription && !hasLectureAccess) {
      return res.status(403).json({ message: 'يجب الاشتراك مع هذا المدرس لعرض الريلز' });
    }

    const filter = { instructorId: resolvedInstructorId, ...req.tenantFilter };
    const [reels, total] = await Promise.all([
      Reel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Reel.countDocuments(filter)
    ]);
    res.json({ data: reels, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/reels/:reelId/view
// protect + authorize('student'). Fire-and-forget style — a single $inc is
// already fast enough not to need special async handling; respond after
// the write completes rather than adding complexity to not block on it.
exports.incrementView = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findOneAndUpdate({ _id: reelId, ...req.tenantFilter }, { $inc: { viewCount: 1 } }, { new: true });
    if (!reel) return res.status(404).json({ message: 'الريلز غير موجود' });
    res.json({ message: 'ok' });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/reels/:reelId
// protect + authorize('admin','assistant').
// ASSUMPTION FLAGGED: an assistant may delete only their OWN uploads
// (uploadedBy === req.user._id); the admin of that instructorId may delete
// ANY reel under their tenant, including ones uploaded by an assistant.
// This is the assumed default — if the teacher wants assistants to be able
// to delete each other's uploads too, relax the uploadedBy check below to
// just the instructorId ownership check.
exports.deleteReel = async (req, res, next) => {
  try {
    const { reelId } = req.params;
    const reel = await Reel.findOne({ _id: reelId, ...req.tenantFilter });
    if (!reel) {
      return res.status(404).json({ message: 'الريلز غير موجود' });
    }

    const isAdminOwner = req.user.role === 'admin' && String(req.user._id) === String(reel.instructorId);
    const isOwnUpload = String(reel.uploadedBy) === String(req.user._id);

    if (!isAdminOwner && !isOwnUpload) {
      return res.status(403).json({ message: 'غير مصرح لك بحذف هذا الريلز' });
    }

    await reel.deleteOne();
    res.json({ message: 'تم حذف الريلز بنجاح' });
  } catch (err) {
    next(err);
  }
};
