const mongoose = require('mongoose');

const standaloneExamSubmissionSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  examId: { type: mongoose.Schema.Types.ObjectId, ref: 'StandaloneExam', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startedAt: { type: Date, required: true },
  submittedAt: { type: Date, default: null },
  answers: { type: [Number], default: [] },
  score: { type: Number, default: null },
  autoSubmitted: { type: Boolean, default: false }
}, { timestamps: true });

// One attempt only: this is enforced by MongoDB, not merely by controller
// logic, so concurrent start requests cannot create duplicate attempts.
standaloneExamSubmissionSchema.index({ examId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('StandaloneExamSubmission', standaloneExamSubmissionSchema);
