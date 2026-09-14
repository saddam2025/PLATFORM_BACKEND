const mongoose = require('mongoose');

// A lecture belongs to one parent Course. There is deliberately no maximum
// lecture count; `order` determines the required learning sequence.
const lectureSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title_ar: { type: String, required: true },
  title_en: { type: String, default: '' },
  description_ar: { type: String, default: '' },
  description_en: { type: String, default: '' },
  order: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, default: 0, min: 0 },
  thumbnailUrl: { type: String, default: null },
  videoUrl: { type: String, default: null },
  // Keep this field absent until Bunny returns a real video id. A sparse
  // unique index still indexes `null`, so a `default: null` lets only one
  // lecture without a video exist.
  bunnyVideoId: { type: String, unique: true, sparse: true },
  bunnyEmbedUrl: { type: String, default: null },
  homeworkUrl: { type: String, default: null },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', default: null },
  accessPeriodDays: { type: Number, default: 10, min: 1 },
  maxViews: { type: Number, default: 10, min: 1 },
  isPublished: { type: Boolean, default: false }
}, { timestamps: true });

lectureSchema.index({ tenantId: 1, courseId: 1, order: 1 }, { unique: true });
module.exports = mongoose.model('Lecture', lectureSchema);
