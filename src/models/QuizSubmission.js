const mongoose = require('mongoose');

const quizSubmissionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    answers: { type: [Number], required: true },
    score: { type: Number, required: true },
    passed: { type: Boolean, required: true },
    // Indexes into quiz.questions that were answered wrong — this is what
    // powers the retry page (getRetryQuiz reads this array directly).
    incorrectQuestionIndexes: { type: [Number], default: [] },
    isRetryAttempt: { type: Boolean, default: false },
    retryOfSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuizSubmission', default: null },
    submittedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('QuizSubmission', quizSubmissionSchema);
