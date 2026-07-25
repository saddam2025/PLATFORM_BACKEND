const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Which student's context this thread is about — a parent's messages
    // are always in reference to their specific child, never generic.
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    read: { type: Boolean, default: false }
  },
  { timestamps: true }
);

messageSchema.index({ studentId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);