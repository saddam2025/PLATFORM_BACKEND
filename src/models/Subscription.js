const mongoose = require('mongoose');
const { STAGE_ENUM } = require('../constants/stages');

const subscriptionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    stage: {
      type: String,
      enum: STAGE_ENUM,
      required: true
    },
    month: { type: String, required: true }, // e.g. "2026-07"
    status: { type: String, enum: ['active', 'expired', 'pending_exam'], default: 'active' },
    monthlyExamPassed: { type: Boolean, default: false },
    monthlyExamSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuizSubmission', default: null },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

// One subscription per student/instructor/stage/month — prevents duplicate
// records and backs the "does last month's subscription exist" gate check.
subscriptionSchema.index({ studentId: 1, instructorId: 1, stage: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
