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

videoProgressSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('VideoProgress', videoProgressSchema);
