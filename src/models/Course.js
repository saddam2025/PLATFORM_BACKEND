const mongoose = require('mongoose');
const { STAGE_ENUM } = require('../constants/stages');

const courseSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    title_en: { type: String, default: '' },
    title_ar: { type: String, required: true },
    description_en: { type: String, default: '' },
    description_ar: { type: String, default: '' },
    price: { type: Number, required: true, default: 0 },
    stage: {
      type: String,
      enum: STAGE_ENUM,
      required: true
    },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    thumbnailUrl: { type: String, default: null },
    videoUrl: { type: String, default: null },
    homeworkUrl: { type: String, default: null },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isPublished: { type: Boolean, default: false },
    accessPeriodDays: { type: Number, default: 10 },
    maxViews: { type: Number, default: 10 },
    quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Course', courseSchema);
