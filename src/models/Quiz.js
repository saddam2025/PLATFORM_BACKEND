const mongoose = require('mongoose');
const { STAGE_ENUM } = require('../constants/stages');

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, default: '' },
    stemType: { type: String, enum: ['text', 'image'], default: 'text' },
    imageUrl: { type: String, default: null },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => arr.length === 4,
        message: 'Each question must have exactly 4 options'
      }
    },
    correctOptionIndex: { type: Number, required: true, min: 0, max: 3 },
    explanation: { type: String, default: '' },
    points: { type: Number, default: 1 }
  },
  { _id: true }
);

const quizSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    title: { type: String, default: '', trim: true },
    // SCHEMA CHANGE from the previous batch: courseId is now OPTIONAL.
    // Regular lecture quizzes still set it (created alongside a Course in
    // courseController.createCourse). Monthly exam quizzes (feature #5) are
    // NOT tied to any single course — they're scoped to an instructor+stage
    // instead — so courseId stays null and type/instructorId/stage/month
    // are used to look the quiz up instead.
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', default: null },
    type: { type: String, enum: ['lecture', 'monthly_exam'], default: 'lecture' },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    stage: {
      type: String,
      enum: STAGE_ENUM,
      default: null
    },
    month: { type: String, default: null }, // e.g. "2026-07", only for type: 'monthly_exam'
    prerequisiteQuizIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' }],
    passingScore: { type: Number, default: 50 },
    timeLimitMinutes: { type: Number, default: null },
    questions: { type: [questionSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Quiz', quizSchema);
