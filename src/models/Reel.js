const mongoose = require('mongoose');
const { STAGE_ENUM } = require('../constants/stages');

const reelSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoUrl: { type: String, required: true },
    bunnyVideoId: { type: String, default: null, unique: true, sparse: true },
    bunnyEmbedUrl: { type: String, default: null },
    caption: { type: String, default: '' },
    // Nullable — null means the reel applies to all stages under this instructor.
    stage: {
      type: String,
      enum: STAGE_ENUM,
      default: null
    },
    viewCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Reel', reelSchema);
