const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    submissionFileUrl: { type: String, default: null },
    submissionNote: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'graded', 'resubmit'], default: 'pending' },
    grade: { type: Number, default: null },
    feedback: { type: String, default: '' },
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Assignment', assignmentSchema);