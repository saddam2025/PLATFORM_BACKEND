const Reel = require('../models/Reel');
const Subscription = require('../models/Subscription');
const LectureAccess = require('../models/LectureAccess');
const Course = require('../models/Course');
const createNotificationsForAudience = require('../utils/createNotification');

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
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
// protect + authorize('student').
// CRITICAL access check per feature #8: being registered under an
// instructorId is NOT the same as being subscribed. A student must have at
// least one active Subscription OR LectureAccess record tied to this
// instructor before any reels are returned — otherwise 403, distinct from
// an empty array, so the frontend can tell "no reels yet" apart from
// "you're not subscribed."
exports.listReels = async (req, res, next) => {
  try {
    const { instructorId } = req.params;

    const hasSubscription = await Subscription.exists({
      studentId: req.user._id,
      instructorId,
      status: 'active'
    });

    let hasLectureAccess = false;
    if (!hasSubscription) {
      // LectureAccess doesn't store instructorId directly — it's scoped by
      // courseId, so we check whether the student has any LectureAccess
      // record for a course belonging to this instructor.
      const instructorCourseIds = await Course.find({ instructorId }).select('_id').lean();
      const courseIds = instructorCourseIds.map((c) => c._id);
      hasLectureAccess = await LectureAccess.exists({
        studentId: req.user._id,
        courseId: { $in: courseIds },
        expiresAt: { $gt: new Date() }
      });
    }

    if (!hasSubscription && !hasLectureAccess) {
      return res.status(403).json({ message: 'يجب الاشتراك مع هذا المدرس لعرض الريلز' });
    }

    const reels = await Reel.find({ instructorId }).sort({ createdAt: -1 });
    res.json({ data: reels });
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
    await Reel.findByIdAndUpdate(reelId, { $inc: { viewCount: 1 } });
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
    const reel = await Reel.findById(reelId);
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