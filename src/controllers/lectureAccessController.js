const LectureAccess = require('../models/LectureAccess');
const CourseEnrollment = require('../models/CourseEnrollment');
const VideoProgress = require('../models/VideoProgress');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const LectureProgress = require('../models/LectureProgress');
const jwt = require('jsonwebtoken');
const path = require('path');

function daysRemaining(expiresAt) {
  const diffMs = new Date(expiresAt) - new Date();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// Shared lecture-scoped entitlement for the detail list and the player gate.
// Legacy full-course rows use LectureAccess.courseId = courseId; Part C's
// individual rows use that legacy key = lectureId.
async function getLectureAccessState({ studentId, tenantFilter, courseId, lectureId }) {
  const now = new Date();
  const [course, lecture] = await Promise.all([
    Course.findOne({ _id: courseId, isPublished: true, ...tenantFilter }).select('_id').lean(),
    Lecture.findOne({ _id: lectureId, courseId, isPublished: true, ...tenantFilter }).lean()
  ]);
  if (!course || !lecture) return { found: false };
  // Neither the course lecture list nor progress rows are needed to calculate
  // this lecture's entitlement. Keeping them in this Promise.all previously
  // referenced `lectures` while that destructuring binding was still in its
  // temporal dead zone, causing every student lecture-list request to throw.
  const [courseEnrollment, accessRows] = await Promise.all([
    CourseEnrollment.findOne({ studentId, courseId, ...tenantFilter, expiresAt: { $gt: now } }).lean(),
    LectureAccess.find({ studentId, courseId: { $in: [courseId, lectureId] }, ...tenantFilter, expiresAt: { $gt: now } }).lean()
  ]);
  const courseAccess = accessRows.find((row) => String(row.courseId) === String(courseId));
  const lectureAccess = accessRows.find((row) => String(row.courseId) === String(lectureId));
  // Lectures are independently selectable. Progress gates the student's next
  // paid checkout, not a numerical lecture sequence.
  const sequenceUnlocked = true;
  const isFree = Number(lecture.price) === 0;
  const isPurchased = Boolean(courseEnrollment || courseAccess || lectureAccess);
  const accessible = isFree || isPurchased;
  const status = isFree ? 'free' : isPurchased ? 'purchased' : 'not_purchased';
  return { found: true, lecture, accessible, status, sequenceUnlocked, isFree, isPurchased, access: lectureAccess || courseAccess || null, includedWithCourse: Boolean(courseEnrollment || courseAccess) };
}

exports.getLectureAccessState = getLectureAccessState;

exports.startLectureView = async (req, res, next) => {
  try {
    const state = await getLectureAccessState({ studentId: req.user._id, tenantFilter: req.tenantFilter, courseId: req.params.courseId, lectureId: req.params.lectureId });
    if (!state.found) return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    if (!state.accessible) return res.status(403).json({ message: state.status === 'pending_previous' ? 'أكمل المحاضرة السابقة أولاً' : 'لم يتم شراء هذه المحاضرة' });
    if (state.access && state.access.viewsUsed >= state.access.maxViews) return res.status(403).json({ message: 'لقد استنفدت عدد مرات المشاهدة المسموحة' });
    if (state.access) { await LectureAccess.updateOne({ _id: state.access._id, studentId: req.user._id, ...req.tenantFilter }, { $inc: { viewsUsed: 1 } }); state.access.viewsUsed += 1; }
    let videoUrl = null;
    if (state.lecture.videoUrl?.startsWith('/uploads/videos/')) {
      const mediaToken = jwt.sign({ sub: String(req.user._id), tenantId: String(req.user.tenantId), courseId: String(req.params.courseId), lectureId: String(req.params.lectureId), media: true }, process.env.JWT_SECRET, { expiresIn: '5m' });
      videoUrl = `${req.protocol}://${req.get('host')}/api/v1/courses/${req.params.courseId}/lectures/${req.params.lectureId}/video?token=${encodeURIComponent(mediaToken)}`;
    }
    res.json({ data: { lecture: { ...state.lecture, videoUrl: null }, videoUrl, viewsRemaining: state.access ? Math.max(0, state.access.maxViews - state.access.viewsUsed) : null, daysRemaining: state.access ? daysRemaining(state.access.expiresAt) : null, watermark: { name: req.user.name, studentId: req.user._id } } });
  } catch (err) { next(err); }
};

async function assertLectureAccess(req) {
  const state = await getLectureAccessState({ studentId: req.user._id, tenantFilter: req.tenantFilter, courseId: req.params.courseId, lectureId: req.params.lectureId });
  if (!state.found) throw Object.assign(new Error('المحاضرة غير موجودة'), { statusCode: 404 });
  if (!state.accessible) throw Object.assign(new Error('لا تملك صلاحية هذه المحاضرة'), { statusCode: 403 });
  return state;
}

exports.updateLectureWatchProgress = async (req, res, next) => {
  try {
    await assertLectureAccess(req);
    const { watchedSeconds, sessionSeconds, totalDurationSeconds } = req.body;
    if (typeof watchedSeconds !== 'number' || typeof sessionSeconds !== 'number') return res.status(400).json({ message: 'بيانات التقدم غير صالحة' });
    const filter = { studentId: req.user._id, lectureId: req.params.lectureId, ...req.tenantFilter };
    const progress = await VideoProgress.findOneAndUpdate(filter, { $setOnInsert: { tenantId: req.user.tenantId, studentId: req.user._id, courseId: req.params.courseId, lectureId: req.params.lectureId }, $max: { watchedSeconds }, $set: { totalDurationSeconds: Number(totalDurationSeconds) || 0, lastWatchedAt: new Date() }, $push: { watchHistory: { watchedAt: new Date(), sessionSeconds } } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    progress.watchPercentage = progress.totalDurationSeconds > 0 ? Math.min(100, Math.round((progress.watchedSeconds / progress.totalDurationSeconds) * 100)) : 0;
    progress.completed = progress.watchPercentage >= 90;
    if (progress.completed) await LectureProgress.findOneAndUpdate({ studentId: req.user._id, lectureId: req.params.lectureId, ...req.tenantFilter }, { $set: { videoCompleted: true }, $setOnInsert: { tenantId: req.user.tenantId, studentId: req.user._id, courseId: req.params.courseId, lectureId: req.params.lectureId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await progress.save();
    res.json({ data: progress });
  } catch (err) { next(err); }
};

exports.getLectureWatchProgress = async (req, res, next) => {
  try { await assertLectureAccess(req); const progress = await VideoProgress.findOne({ studentId: req.user._id, lectureId: req.params.lectureId, ...req.tenantFilter }); res.json({ data: progress || null }); } catch (err) { next(err); }
};

// Browser video elements cannot attach the app's Bearer token, so start-view
// issues a short-lived signed media token. This handler validates that token
// AND re-runs the tenant/student entitlement check on every range/content
// request before serving the local video file.
exports.streamLectureVideo = async (req, res, next) => {
  try {
    const claims = jwt.verify(req.query.token, process.env.JWT_SECRET);
    if (!claims.media || String(claims.courseId) !== String(req.params.courseId) || String(claims.lectureId) !== String(req.params.lectureId)) return res.status(403).json({ message: 'رابط الفيديو غير صالح' });
    const state = await getLectureAccessState({ studentId: claims.sub, tenantFilter: { tenantId: claims.tenantId }, courseId: req.params.courseId, lectureId: req.params.lectureId });
    if (!state.found || !state.accessible || !state.lecture.videoUrl?.startsWith('/uploads/videos/')) return res.status(403).json({ message: 'لا تملك صلاحية هذه المحاضرة' });
    const fileName = path.basename(state.lecture.videoUrl);
    return res.sendFile(fileName, { root: path.join(__dirname, '..', 'uploads', 'videos'), headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') return res.status(403).json({ message: 'رابط الفيديو غير صالح أو منتهي' });
    return next(err);
  }
};

// GET /api/v1/courses/enrolled
// The dashboard supports both access schemes during the Course -> Lectures
// transition: legacy per-course LectureAccess rows and new CourseEnrollment
// rows both establish ownership.
async function getEnrolledCoursesForStudent({ studentId, tenantFilter }) {
    const now = new Date();
    const courseSelection = 'title_ar title_en description_ar description_en thumbnailUrl stage price';
    const [accessRecords, enrollmentRecords] = await Promise.all([
      LectureAccess.find({ studentId, ...tenantFilter, expiresAt: { $gt: now } })
        .lean()
        .sort({ purchasedAt: -1 }),
      CourseEnrollment.find({ studentId, ...tenantFilter, expiresAt: { $gt: now } })
        .populate({ path: 'courseId', match: { isPublished: true }, select: courseSelection })
        .sort({ purchasedAt: -1 })
    ]);

    // LectureAccess.courseId is overloaded: older rows contain a Course id,
    // while single-lecture rows contain a Lecture id. Resolve both shapes
    // explicitly; populate() cannot do this because its declared ref is Course.
    const accessIds = accessRecords.map((access) => access.courseId).filter(Boolean);
    const [legacyCourses, individuallyOwnedLectures] = await Promise.all([
      accessIds.length ? Course.find({ _id: { $in: accessIds }, isPublished: true, ...tenantFilter }).select(courseSelection).lean() : [],
      accessIds.length ? Lecture.find({ _id: { $in: accessIds }, ...tenantFilter }).select('_id courseId').lean() : []
    ]);
    const legacyCourseById = new Map(legacyCourses.map((course) => [String(course._id), course]));
    const lecturesByCourse = new Map();
    for (const lecture of individuallyOwnedLectures) {
      const id = String(lecture.courseId);
      lecturesByCourse.set(id, [...(lecturesByCourse.get(id) || []), String(lecture._id)]);
    }
    const partialCourseIds = [...lecturesByCourse.keys()];
    const partialCourses = partialCourseIds.length
      ? await Course.find({ _id: { $in: partialCourseIds }, isPublished: true, ...tenantFilter }).select(courseSelection).lean()
      : [];

    // A student can have a legacy record and a full enrollment for the same
    // course. Keep one dashboard card, preferring full-course enrollment.
    const coursesById = new Map();
    for (const access of accessRecords) {
      const course = legacyCourseById.get(String(access.courseId));
      if (!course) continue;
      coursesById.set(String(course._id), {
        accessId: access._id,
        course,
        purchasedAt: access.purchasedAt,
        expiresAt: access.expiresAt,
        viewsRemaining: Math.max(0, access.maxViews - access.viewsUsed),
        fullAccess: true
      });
    }
    for (const enrollment of enrollmentRecords) {
      if (!enrollment.courseId) continue;
      coursesById.set(String(enrollment.courseId._id), {
        accessId: enrollment._id,
        course: enrollment.courseId,
        purchasedAt: enrollment.purchasedAt,
        expiresAt: enrollment.expiresAt,
        viewsRemaining: null,
        includedWithCourse: true,
        fullAccess: true
      });
    }
    // Any single owned lecture puts its parent course in "كورساتي"; this is
    // deliberately not full ownership, so catalog visibility remains intact.
    for (const course of partialCourses) {
      if (coursesById.has(String(course._id))) continue;
      const ownedLectureIds = lecturesByCourse.get(String(course._id)) || [];
      const firstAccess = accessRecords.find((access) => ownedLectureIds.includes(String(access.courseId)));
      coursesById.set(String(course._id), {
        course,
        purchasedAt: firstAccess?.purchasedAt || now,
        expiresAt: firstAccess?.expiresAt || now,
        viewsRemaining: null,
        partialLectureCount: ownedLectureIds.length,
        fullAccess: false
      });
    }
    const courseIds = [...coursesById.keys()];
    const lectureCounts = courseIds.length ? await Lecture.aggregate([{ $match: { courseId: { $in: courseIds.map((id) => new (require('mongoose').Types.ObjectId)(id)) }, isPublished: true, ...tenantFilter } }, { $group: { _id: '$courseId', count: { $sum: 1 } } }]) : [];
    const countByCourse = new Map(lectureCounts.map((row) => [String(row._id), row.count]));
    for (const [courseId, value] of coursesById) value.course = { ...(value.course.toObject ? value.course.toObject() : value.course), lectureCount: countByCourse.get(courseId) || 0 };
    const courses = [...coursesById.values()]
      .sort((left, right) => new Date(right.purchasedAt) - new Date(left.purchasedAt));
    return courses;
}

exports.getEnrolledCoursesForStudent = getEnrolledCoursesForStudent;

exports.listEnrolledCourses = async (req, res, next) => {
  try {
    const courses = await getEnrolledCoursesForStudent({ studentId: req.user._id, tenantFilter: req.tenantFilter });
    res.json({ data: courses });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/courses/:courseId/start-view
// protect + authorize('student'). This is the gatekeeper CoursePlayerPage.jsx
// MUST call before rendering the <video> element — the mock `access` object
// currently in that file needs to be replaced by a real call to this route.
exports.startView = async (req, res, next) => {
  try {
    const { courseId } = req.params;

    const access = await LectureAccess.findOne({ studentId: req.user._id, courseId, ...req.tenantFilter });
    if (!access) {
      return res.status(404).json({ message: 'لم يتم شراء هذه المحاضرة' });
    }

    if (new Date() > new Date(access.expiresAt)) {
      return res.status(403).json({ message: 'انتهت صلاحية الوصول لهذه المحاضرة' });
    }

    if (access.viewsUsed >= access.maxViews) {
      return res.status(403).json({ message: 'لقد استنفدت عدد مرات المشاهدة المسموحة' });
    }

    const course = await Course.findOne({ _id: courseId, isPublished: true, ...req.tenantFilter });
    if (!course) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    access.viewsUsed += 1;
    await access.save();

    // CRITICAL — deliberate, non-negotiable choice: watermark.name and
    // watermark.studentId come ONLY from req.user (the authenticated JWT
    // payload), never from anything in req.body or req.query. Accepting a
    // client-supplied name for the anti-piracy watermark (feature #1) would
    // let a student trivially spoof it — e.g. submit someone else's name —
    // defeating the entire point of the feature. There is no code path in
    // this handler that reads a name/studentId from the request body.
    res.json({
      data: {
        videoUrl: course.videoUrl,
        viewsRemaining: access.maxViews - access.viewsUsed,
        daysRemaining: daysRemaining(access.expiresAt),
        watermark: {
          name: req.user.name,
          studentId: req.user._id
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/courses/:courseId/watch-progress
// protect + authorize('student'). Body: { watchedSeconds, sessionSeconds,
// totalDurationSeconds }. Does NOT touch LectureAccess.viewsUsed — view
// counting only happens once per session via start-view; this endpoint just
// tracks position/history within an already-granted session.
exports.updateWatchProgress = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const { watchedSeconds, sessionSeconds, totalDurationSeconds } = req.body;

    if (typeof watchedSeconds !== 'number' || typeof sessionSeconds !== 'number') {
      return res.status(400).json({ message: 'بيانات التقدم غير صالحة' });
    }

    const course = await Course.findOne({ _id: courseId, isPublished: true, ...req.tenantFilter }).select('_id');
    if (!course) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    let progress = await VideoProgress.findOne({ studentId: req.user._id, courseId, ...req.tenantFilter });

    if (!progress) {
      progress = new VideoProgress({
        tenantId: req.user.tenantId,
        studentId: req.user._id,
        courseId,
        watchedSeconds: 0,
        totalDurationSeconds: totalDurationSeconds || 0,
        watchHistory: []
      });
    }

    // Never regress progress on rewind — only advance watchedSeconds if the
    // new furthest position is actually further than what's already stored.
    if (watchedSeconds > progress.watchedSeconds) {
      progress.watchedSeconds = watchedSeconds;
    }

    if (totalDurationSeconds && totalDurationSeconds > 0) {
      progress.totalDurationSeconds = totalDurationSeconds;
    }

    progress.watchPercentage =
      progress.totalDurationSeconds > 0
        ? Math.min(100, Math.round((progress.watchedSeconds / progress.totalDurationSeconds) * 100))
        : 0;

    if (progress.watchPercentage >= 90) {
      progress.completed = true;
    }

    progress.lastWatchedAt = new Date();
    // Append-only — every session is pushed, never overwritten, so the
    // watch history is a genuine chronological log (feature #2).
    progress.watchHistory.push({ watchedAt: new Date(), sessionSeconds });

    await progress.save();

    res.json({ data: progress });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/courses/:courseId/watch-progress
// protect + authorize('student') — returns only the CALLER's own progress,
// used by CoursePlayerPage to resume where they left off.
exports.getWatchProgress = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findOne({ _id: courseId, isPublished: true, ...req.tenantFilter }).select('_id');
    if (!course) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }
    const progress = await VideoProgress.findOne({ studentId: req.user._id, courseId, ...req.tenantFilter });
    res.json({ data: progress || null });
  } catch (err) {
    next(err);
  }
};
