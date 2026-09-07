const mongoose = require('mongoose');

// Purchasing a complete course grants access to every lecture under it.
const courseEnrollmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  purchasedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  source: { type: String, enum: ['paymob', 'wallet', 'access_code', 'free'], required: true }
}, { timestamps: true });

courseEnrollmentSchema.index({ tenantId: 1, studentId: 1, courseId: 1 }, { unique: true });
module.exports = mongoose.model('CourseEnrollment', courseEnrollmentSchema);
