const Reel = require('../models/Reel');
const LectureAccess = require('../models/LectureAccess');
const CourseEnrollment = require('../models/CourseEnrollment');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const BunnyUpload = require('../models/BunnyUpload');
const mongoose = require('mongoose');
const createNotificationsForAudience = require('../utils/createNotification');
const { createVideoSlot, directTusUpload, getVerifiedUploadedVideo, playbackUrls, DIRECT_UPLOAD_TTL_SECONDS } = require('../utils/bunnyStream');
const { STAGE_ENUM } = require('../constants/stages');

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
// A student sees reels only when both their own academic stage matches the
// reel and they own at least one item from the requested instructor.
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

    if (!req.user.stage) {
      return res.status(422).json({ message: 'المرحلة الدراسية غير مسجلة في حساب الطالب' });
    }

    // Condition 1: ownership is evaluated only against this instructor's
    // tenant-scoped courses and lectures. LectureAccess is intentionally
    // checked with both IDs because legacy rows use a Course id while new
    // single-lecture rows use a Lecture id.
    const instructorCourses = await Course.find({ instructorId: resolvedInstructorId, ...req.tenantFilter }).select('_id').lean();
    const courseIds = instructorCourses.map((course) => course._id);
    const instructorLectures = courseIds.length
      ? await Lecture.find({ courseId: { $in: courseIds }, ...req.tenantFilter }).select('_id').lean()
      : [];
    const protectedItemIds = [...courseIds, ...instructorLectures.map((lecture) => lecture._id)];
    const now = new Date();
    const [hasCourseEnrollment, hasLectureAccess] = await Promise.all([
      courseIds.length
        ? CourseEnrollment.exists({ studentId: req.user._id, courseId: { $in: courseIds }, expiresAt: { $gt: now }, ...req.tenantFilter })
        : false,
      protectedItemIds.length
        ? LectureAccess.exists({ studentId: req.user._id, courseId: { $in: protectedItemIds }, expiresAt: { $gt: now }, ...req.tenantFilter })
        : false
    ]);

    if (!hasCourseEnrollment && !hasLectureAccess) {
      return res.json({ data: [], pagination: { page, limit, total: 0, totalPages: 0 } });
    }

    // Condition 2: stage equality is a separate filter; global/null-stage
    // reels are deliberately excluded because this student endpoint requires
    // an exact stage match.
    const filter = { instructorId: resolvedInstructorId, stage: req.user.stage, ...req.tenantFilter };
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

// POST /api/v1/instructors/:instructorId/reels/upload-init
// Creates only a Bunny slot and a short-lived server-side upload record; the
// browser uploads directly to Bunny using the scoped TUS signature returned.
exports.initReelUpload = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { caption = '', stage = null, title } = req.body || {};
    if (!isOwnerOfInstructor(req.user, instructorId)) return res.status(403).json({ message: 'غير مصرح لك برفع ريلز لهذا الحساب' });
    if (typeof caption !== 'string' || caption.length > 1000 || (stage && !STAGE_ENUM.includes(stage))) return res.status(400).json({ message: 'بيانات الريلز غير صالحة' });

    const { settings, videoId } = await createVideoSlot(title || caption || 'Reel');
    const pending = await BunnyUpload.create({
      tenantId: req.user.tenantId,
      instructorId,
      uploadedBy: req.user._id,
      target: 'reel',
      bunnyVideoId: videoId,
      caption: caption.trim(),
      stage: stage || null,
      expiresAt: new Date(Date.now() + DIRECT_UPLOAD_TTL_SECONDS * 1000)
    });
    return res.status(201).json({ data: { uploadId: pending._id, videoId, upload: directTusUpload(videoId, settings) } });
  } catch (err) { next(err); }
};

// POST /api/v1/instructors/:instructorId/reels/confirm-upload
// Never trusts the browser's completion claim: Bunny's authenticated GET is
// performed before a Reel document is created.
exports.confirmReelUpload = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { uploadId } = req.body || {};
    if (!mongoose.isValidObjectId(uploadId) || !isOwnerOfInstructor(req.user, instructorId)) return res.status(403).json({ message: 'تأكيد رفع الريلز غير مصرح به' });
    const pending = await BunnyUpload.findOne({ _id: uploadId, target: 'reel', tenantId: req.user.tenantId, instructorId, uploadedBy: req.user._id });
    if (!pending || pending.expiresAt <= new Date()) return res.status(404).json({ message: 'طلب رفع الريلز غير موجود أو منتهي' });

    const { video, settings } = await getVerifiedUploadedVideo(pending.bunnyVideoId);
    const claimed = await BunnyUpload.findOneAndUpdate(
      { _id: pending._id, expiresAt: { $gt: new Date() }, confirmedAt: null },
      { $set: { confirmedAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      const existing = await Reel.findOne({ bunnyVideoId: pending.bunnyVideoId, ...req.tenantFilter });
      if (existing) return res.json({ data: existing });
      return res.status(409).json({ message: 'يجري تأكيد هذا الرفع بالفعل؛ أعد المحاولة بعد لحظات' });
    }
    const urls = playbackUrls(pending.bunnyVideoId, settings);
    try {
      const reel = await Reel.create({ tenantId: pending.tenantId, instructorId, uploadedBy: req.user._id, caption: pending.caption, stage: pending.stage, bunnyVideoId: video.guid, ...urls });
      await BunnyUpload.deleteOne({ _id: claimed._id });
      await createNotificationsForAudience({ tenantId: reel.tenantId, instructorId, type: 'new_reel', title: 'ريلز جديد', body: reel.caption || 'تم نشر مقطع فيديو قصير جديد', relatedId: reel._id, audience: 'both' });
      return res.status(201).json({ data: reel });
    } catch (err) {
      const existing = await Reel.findOne({ bunnyVideoId: pending.bunnyVideoId, ...req.tenantFilter });
      if (existing) return res.json({ data: existing });
      await BunnyUpload.updateOne({ _id: claimed._id }, { $set: { confirmedAt: null } });
      throw err;
    }
  } catch (err) { next(err); }
};
