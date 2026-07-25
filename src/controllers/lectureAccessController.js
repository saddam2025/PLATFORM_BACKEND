const LectureAccess = require('../models/LectureAccess');
const VideoProgress = require('../models/VideoProgress');
const Course = require('../models/Course');

function daysRemaining(expiresAt) {
  const diffMs = new Date(expiresAt) - new Date();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// POST /api/v1/courses/:courseId/start-view
// protect + authorize('student'). This is the gatekeeper CoursePlayerPage.jsx
// MUST call before rendering the <video> element — the mock `access` object
// currently in that file needs to be replaced by a real call to this route.
exports.startView = async (req, res, next) => {
  try {
    const { courseId } = req.params;

    const access = await LectureAccess.findOne({ studentId: req.user._id, courseId });
    if (!access) {
      return res.status(404).json({ message: 'لم يتم شراء هذه المحاضرة' });
    }

    if (new Date() > new Date(access.expiresAt)) {
      return res.status(403).json({ message: 'انتهت صلاحية الوصول لهذه المحاضرة' });
    }

    if (access.viewsUsed >= access.maxViews) {
      return res.status(403).json({ message: 'لقد استنفدت عدد مرات المشاهدة المسموحة' });
    }

    const course = await Course.findById(courseId);
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

    let progress = await VideoProgress.findOne({ studentId: req.user._id, courseId });

    if (!progress) {
      progress = new VideoProgress({
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
    const progress = await VideoProgress.findOne({ studentId: req.user._id, courseId });
    res.json({ data: progress || null });
  } catch (err) {
    next(err);
  }
};