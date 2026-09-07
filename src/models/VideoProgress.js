const mongoose = require('mongoose');

const watchHistoryEntrySchema = new mongoose.Schema(
  {
    watchedAt: { type: Date, default: Date.now },
    sessionSeconds: { type: Number, required: true }
  },
  { _id: false }
);

const videoProgressSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    // Legacy rows use courseId; all new player rows use lectureId as well.
    lectureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', default: null },
    watchedSeconds: { type: Number, default: 0 }, // furthest position ever reached
    totalDurationSeconds: { type: Number, default: 0 },
    watchPercentage: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    lastWatchedAt: { type: Date, default: Date.now },
    // Append-only log — every viewing session is pushed here, never
    // overwritten. This is what powers feature #2's "complete history of
    // all watched videos" requirement.
    watchHistory: { type: [watchHistoryEntrySchema], default: [] }
  },
  { timestamps: true }
);

// Do not make courseId unique: a student has one progress record per lecture.
videoProgressSchema.index({ tenantId: 1, studentId: 1, courseId: 1 });
videoProgressSchema.index({ tenantId: 1, studentId: 1, lectureId: 1 }, { unique: true, partialFilterExpression: { lectureId: { $type: 'objectId' } } });

module.exports = mongoose.model('VideoProgress', videoProgressSchema);
