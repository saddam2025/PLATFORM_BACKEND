const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subdomain: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    logoUrl: { type: String, default: null },
    supportPhone: { type: String, default: '' },
    supportEmail: { type: String, default: '' },
    themeColors: {
      primary: { type: String, default: null },
      secondary: { type: String, default: null }
    },
    videoDelivery: {
      provider: { type: String, default: '' },
      pullZone: { type: String, default: '' },
      maxViewsPerLesson: { type: Number, default: 10 },
      accessWindowDays: { type: Number, default: 10 }
    },
    notificationPreferences: {
      smsEnabled: { type: Boolean, default: false },
      emailEnabled: { type: Boolean, default: true },
      whatsappEnabled: { type: Boolean, default: false }
    },
    // Tenant-owned public presentation fields. This keeps public discovery
    // independent of admin User records and owner identifiers.
    tagline: { type: String, default: '' },
    bio: { type: String, default: '' },
    subject: { type: String, default: '' },
    location: { type: String, default: '' },
    coverPhotoUrl: { type: String, default: null },
    stagesOffered: { type: [String], default: [] },
    monthlyPrice: { type: Number, default: null },
    perLecturePrice: { type: Number, default: null },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true },
    subscriptionStatus: { type: String, enum: ['active', 'suspended', 'trial'], default: 'trial' },
    deletedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Tenant', tenantSchema);
