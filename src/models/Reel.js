const mongoose = require('mongoose');

const reelSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoUrl: { type: String, required: true },
    caption: { type: String, default: '' },
    // Nullable — null means the reel applies to all stages under this instructor.
    stage: {
      type: String,
      enum: ['grade-7', 'grade-8', 'grade-9', 'grade-10', 'grade-11', 'grade-12'],
      default: null
    },
    viewCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Reel', reelSchema);
