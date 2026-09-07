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

// One current submission per student and course. The submit endpoint uses an
// upsert, and this index also protects against concurrent duplicate requests.
assignmentSchema.index({ tenantId: 1, studentId: 1, courseId: 1 }, { unique: true });
assignmentSchema.index({ tenantId: 1, studentId: 1, lectureId: 1 }, { unique: true, partialFilterExpression: { lectureId: { $type: 'objectId' } } });

module.exports = mongoose.model('Assignment', assignmentSchema);
