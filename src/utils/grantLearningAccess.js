const CourseEnrollment = require('../models/CourseEnrollment');
const LectureAccess = require('../models/LectureAccess');

function expiry(days) { const value = new Date(); value.setDate(value.getDate() + Number(days || 10)); return value; }

async function grantCourseEnrollment({ course, studentId, tenantId, source, session = null }) {
  const identity = { tenantId, studentId, courseId: course._id };
  const now = new Date();
  const expiresAt = expiry(course.accessPeriodDays);
  const existing = await CourseEnrollment.findOne(identity).session(session);

  if (existing) {
    // Keep active access (and its original purchase window) idempotent. A
    // re-purchase after expiry renews this unique row with a fresh window.
    if (existing.expiresAt > now) return existing;
    existing.purchasedAt = now;
    existing.expiresAt = expiresAt;
    existing.source = source;
    await existing.save({ session });
    return existing;
  }

  return CourseEnrollment.create([{ ...identity, purchasedAt: now, expiresAt, source }], { session }).then(([created]) => created);
}

// LectureAccess is the pre-existing per-item access mechanism. Its legacy
// `courseId` key stores the protected item's id, which lectureController
// already compares against lecture._id; keeping that representation avoids a
// parallel access collection during this migration.
async function grantLectureAccess({ lecture, studentId, tenantId, session = null }) {
  return LectureAccess.findOneAndUpdate(
    { tenantId, studentId, courseId: lecture._id },
    { $setOnInsert: { tenantId, studentId, courseId: lecture._id, purchasedAt: new Date(), expiresAt: expiry(lecture.accessPeriodDays), maxViews: lecture.maxViews, viewsUsed: 0 } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
}

module.exports = { grantCourseEnrollment, grantLectureAccess };
