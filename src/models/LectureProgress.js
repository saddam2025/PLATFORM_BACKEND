const mongoose = require('mongoose');

const lectureProgressSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    homeworkCompleted: { type: Boolean, default: false },
    quizPassed: { type: Boolean, default: false },
    unlockedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

lectureProgressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('LectureProgress', lectureProgressSchema);
