const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', default: null },
    submissionFileUrl: { type: String, default: null },
    submissionNote: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'graded', 'resubmit'], default: 'pending' },
    grade: { type: Number, default: null },
    feedback: { type: String, default: '' },
    gradedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// A student can submit one assignment for each lecture. The lecture-level
// index also prevents duplicate concurrent submissions for that same lecture.
assignmentSchema.index({ tenantId: 1, studentId: 1, lectureId: 1 }, { unique: true, partialFilterExpression: { lectureId: { $type: 'objectId' } } });

module.exports = mongoose.model('Assignment', assignmentSchema);
