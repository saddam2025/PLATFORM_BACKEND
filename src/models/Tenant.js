const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subdomain: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    logoUrl: { type: String, default: null },
    themeColors: {
      primary: { type: String, default: null },
      secondary: { type: String, default: null }
    },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
    subscriptionStatus: { type: String, enum: ['active', 'suspended', 'trial'], default: 'trial' },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', tenantSchema);
