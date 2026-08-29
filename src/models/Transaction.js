const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['topup', 'purchase', 'refund'], required: true },
    source: { type: String, enum: ['paymob', 'scratchcard', 'access_code', 'wallet'], required: true },
    amount: { type: Number, required: true },
    relatedCourseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    paymobTxId: { type: String, default: null },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
