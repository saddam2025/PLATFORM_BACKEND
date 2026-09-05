const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { STAGE_ENUM } = require('../constants/stages');

const PERMISSION_ENUM = ['can_upload_video', 'can_grade_exams', 'can_generate_access_codes'];
const TRACK_ENUM = ['علمي علوم', 'علمي رياضة', 'أدبي'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    phone: { type: String, default: '' },
    passwordHash: { type: String, required: true, select: true },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'assistant', 'student', 'parent'],
      required: true
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
      required: function () {
        return this.role !== 'super_admin';
      }
    },
    stage: {
      type: String,
      enum: STAGE_ENUM,
      required: function () {
        return this.role === 'student';
      },
      default: null
    },
    track: {
      type: String,
      enum: TRACK_ENUM,
      default: null
    },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    permissions: {
      type: [String],
      enum: PERMISSION_ENUM,
      default: []
    },
    inviteToken: { type: String, select: false },
    inviteStatus: {
      type: String,
      enum: ['pending', 'active'],
      default: 'active'
    },
    childId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    parentAccessCode: { type: String, unique: true, sparse: true },
    walletBalance: { type: Number, default: 0 },
    avatarUrl: { type: String, default: null },
    themePreference: { type: String, enum: ['light', 'dark'], default: 'light' },
    isActive: { type: Boolean, default: true },
    // Soft-deletion is used for assistant accounts so existing related data is
    // retained without allowing the account to authenticate or be listed.
    deletedAt: { type: Date, default: null },
    // NEW (this batch) — only meaningful for role === 'admin'. Paymob
    // credentials are highly sensitive: paymobApiKey and
    // paymobWebhookSecret are effectively secrets equivalent to a password,
    // and must NEVER leak to students/assistants/parents querying instructor
    // info. select: false means they are excluded from every query by
    // default and must be explicitly .select('+paymobApiKey') when actually
    // needed server-side (e.g. paymentController).
    paymobApiKey: { type: String, default: null, select: false },
    paymobIntegrationId: { type: String, default: null },
    paymobWebhookSecret: { type: String, default: null, select: false },
    brandLogo: { type: String, default: null }
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  } catch (err) {
    throw err;
  }
});

userSchema.pre('save', async function () {
  if (this.role !== 'student' || this.parentAccessCode) return;

  const generate = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  };

  let code;
  let exists = true;
  let attempts = 0;
  const MAX_ATTEMPTS = 10;

  while (exists && attempts < MAX_ATTEMPTS) {
    code = generate();
    // eslint-disable-next-line no-await-in-loop
    exists = await mongoose.models.User.exists({ parentAccessCode: code });
    attempts += 1;
  }

  if (exists) {
    throw new Error('Failed to generate a unique parent access code, please retry');
  }

  this.parentAccessCode = code;
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

// OWASP A02 — passwordHash, inviteToken, paymobApiKey, and
// paymobWebhookSecret must NEVER leave the server in a generic response.
// paymobApiKey/paymobWebhookSecret already default to select:false at the
// schema level (so a plain find()/findById() never returns them at all),
// but this transform is a defense-in-depth second layer for the rare case
// a controller explicitly .select('+paymobApiKey')'d a document (e.g. the
// admin's own settings page) and then accidentally sent that same document
// object back out to a DIFFERENT user in some shared response path. Callers
// that legitimately need these fields (paymentController, admin's own
// settings save/read) must read them directly off the raw Mongoose
// document BEFORE calling toJSON(), not after.
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.inviteToken;
    delete ret.paymobApiKey;
    delete ret.paymobWebhookSecret;
    return ret;
  }
});

const User = mongoose.model('User', userSchema);
module.exports = User;
module.exports.PERMISSION_ENUM = PERMISSION_ENUM;
module.exports.STAGE_ENUM = STAGE_ENUM;
module.exports.TRACK_ENUM = TRACK_ENUM;
