const mongoose = require('mongoose');

// NOTE: records in this collection are CREATED elsewhere — by checkout/
// payment success handlers (scratch card redemption, Paymob webhook,
// access-code redemption), which live in batch B7. This batch (B6) only
// READS and ENFORCES LectureAccess via start-view; it never creates rows.
// If B7 hasn't been applied yet in a dev environment, start-view will
// correctly 404 with "لم يتم شراء هذه المحاضرة" for every course, since no
// LectureAccess documents exist yet — that is expected, not a bug.
const lectureAccessSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    purchasedAt: { type: Date, default: Date.now },
    // Snapshotted at purchase time from course.accessPeriodDays — deliberately
    // NOT recalculated from the live Course document later. If a teacher
    // edits a course's accessPeriodDays after students have already
    // purchased, those students' existing access windows are unaffected.
    expiresAt: { type: Date, required: true },
    // Snapshotted at purchase time from course.maxViews, same reasoning.
    maxViews: { type: Number, required: true },
    viewsUsed: { type: Number, default: 0 }
  },
  { timestamps: true }
);

lectureAccessSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('LectureAccess', lectureAccessSchema);