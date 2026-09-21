const mongoose = require('mongoose');
const { STAGE_ENUM } = require('../constants/stages');

const standaloneExamQuestionSchema = new mongoose.Schema({
  text: { type: String, default: '', trim: true },
  stemType: { type: String, enum: ['text', 'image'], default: 'text' },
  imageUrl: { type: String, default: null },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: (options) => Array.isArray(options) && options.length === 4,
      message: 'Each question must have exactly 4 options'
    }
  },
  correctOptionIndex: { type: Number, required: true, min: 0, max: 3 },
  points: { type: Number, required: true, min: 0.01 }
}, { _id: true });

const standaloneExamSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  title: { type: String, required: true, trim: true },
  thumbnailUrl: { type: String, default: null },
  stage: { type: String, enum: STAGE_ENUM, required: true },
  durationMinutes: { type: Number, required: true, min: 1 },
  questions: { type: [standaloneExamQuestionSchema], default: [] },
  status: { type: String, enum: ['draft', 'published', 'closed'], default: 'draft', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

standaloneExamSchema.index({ tenantId: 1, stage: 1, status: 1 });

module.exports = mongoose.model('StandaloneExam', standaloneExamSchema);
