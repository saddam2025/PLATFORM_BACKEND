const mongoose = require('mongoose');

const lectureProgressSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    // New rows are lecture-scoped. `courseId` is retained only for the
    // pre-restructure rows and must not be used by new progression code.
    lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', default: null },
    videoCompleted: { type: Boolean, default: false },
    homeworkCompleted: { type: Boolean, default: false },
    quizPassed: { type: Boolean, default: false },
    unlockedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

lectureProgressSchema.index({ tenantId: 1, studentId: 1, lectureId: 1 }, { unique: true, partialFilterExpression: { lectureId: { $type: 'objectId' } } });

module.exports = mongoose.model('LectureProgress', lectureProgressSchema);
