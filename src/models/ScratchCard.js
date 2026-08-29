const mongoose = require('mongoose');

const scratchCardSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    // NEVER the plaintext code — only its hash. See utils/generateCode.js
    // for why plaintext is never persisted anywhere.
    code_hash: { type: String, required: true, unique: true },
    value: { type: Number, required: true }, // wallet top-up amount
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    redeemedAt: { type: Date, default: null },
    batchId: { type: String, required: true },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isRedeemed: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScratchCard', scratchCardSchema);
