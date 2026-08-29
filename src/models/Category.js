const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    stage: {
      type: String,
      enum: ['grade-7', 'grade-8', 'grade-9', 'grade-10', 'grade-11', 'grade-12'],
      required: true
    }
  },
  { timestamps: true }
);

// Categories are scoped per-instructor-per-stage — "الشهر الأول" for one
// instructor/stage is a distinct document from another instructor's or
// another stage's category with the same name.
categorySchema.index({ name: 1, instructorId: 1, stage: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
