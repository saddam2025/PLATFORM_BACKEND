const mongoose = require('mongoose');

const accessCodeSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    // Same hashing approach as ScratchCard — never store the plaintext.
    code_hash: { type: String, required: true, unique: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', default: null },
    type: { type: String, enum: ['full_course', 'single_lecture'], default: 'full_course', required: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // admin or assistant
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    redeemedAt: { type: Date, default: null },
    isRedeemed: { type: Boolean, default: false },
    batchId: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AccessCode', accessCodeSchema);
