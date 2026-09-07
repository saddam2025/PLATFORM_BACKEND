const CourseEnrollment = require('../models/CourseEnrollment');
const LectureAccess = require('../models/LectureAccess');

function expiry(days) { const value = new Date(); value.setDate(value.getDate() + Number(days || 10)); return value; }

async function grantCourseEnrollment({ course, studentId, tenantId, source, session = null }) {
  return CourseEnrollment.findOneAndUpdate(
    { tenantId, studentId, courseId: course._id },
    { $setOnInsert: { tenantId, studentId, courseId: course._id, purchasedAt: new Date(), expiresAt: expiry(course.accessPeriodDays), source } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );
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
