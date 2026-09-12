const mongoose = require('mongoose');

// Short-lived, server-owned proof that a particular Bunny video slot was
// created for this tenant/user. It prevents a client from confirming an
// arbitrary video ID from the shared Bunny library.
const bunnyUploadSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  target: { type: String, enum: ['reel', 'lecture'], required: true },
  bunnyVideoId: { type: String, required: true, unique: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
  lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', default: null },
  caption: { type: String, default: '' },
  stage: { type: String, default: null },
  // A confirmation claim is set atomically before the target record is
  // written. This makes a retry safe if two browser requests arrive together
  // and, unlike deleting first, does not discard the proof on a DB failure.
  confirmedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, expires: 0 }
}, { timestamps: true });

module.exports = mongoose.model('BunnyUpload', bunnyUploadSchema);
