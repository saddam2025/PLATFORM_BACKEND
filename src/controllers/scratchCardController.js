const crypto = require('crypto');
const mongoose = require('mongoose');
const ScratchCard = require('../models/ScratchCard');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { generateBatch, hashCode } = require('../utils/generateCode');

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

function getTenantFilter(req) {
  return req.tenantFilter || { tenantId: req.user.tenantId };
}

function hasTenant(req) {
  return req.user.role === 'super_admin' || mongoose.isValidObjectId(req.user.tenantId);
}

// POST /api/v1/instructors/:instructorId/scratchcards/generate
// Plaintext codes are returned exactly once and only their hashes are stored.
exports.generateScratchCards = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const body = req.body;

    if (!mongoose.isValidObjectId(instructorId)) {
      return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ message: 'بيانات الطلب غير صالحة' });
    }
    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتوليد بطاقات لهذا الحساب' });
    }
    if (!hasTenant(req)) {
      return res.status(400).json({ message: 'حسابك غير مرتبط بمؤسسة' });
    }

    const count = Number(body.count);
    const value = Number(body.value);
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
      return res.status(400).json({ message: 'عدد البطاقات غير صالح' });
    }
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ message: 'قيمة البطاقة غير صالحة' });
    }
    if (body.batchId !== undefined && (typeof body.batchId !== 'string' || !body.batchId.trim() || body.batchId.length > 100)) {
      return res.status(400).json({ message: 'معرف الدفعة غير صالح' });
    }

    const batchId = body.batchId?.trim() || crypto.randomBytes(4).toString('hex');
    const { plaintextCodes, hashedCodes } = generateBatch(count);
    const tenantId = req.user.tenantId;
    const cards = hashedCodes.map((codeHash) => ({
      tenantId,
      code_hash: codeHash,
      value,
      batchId,
      generatedBy: req.user._id
    }));

    await ScratchCard.insertMany(cards);
    res.status(201).json({
      data: {
        batchId,
        count,
        value,
        codes: plaintextCodes
      }
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/scratchcards?batchId=&status=
// Intentionally returns no plaintext code and no hash. Codes are reveal-once
// credentials; after generation only code_hash is persisted.
exports.listScratchCards = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { batchId, status } = req.query;
    if (!mongoose.isValidObjectId(instructorId)) return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    if (String(req.user._id) !== String(instructorId)) return res.status(403).json({ message: 'غير مصرح لك بعرض بطاقات هذا الحساب' });
    if (batchId !== undefined && (typeof batchId !== 'string' || !batchId.trim() || batchId.length > 100)) return res.status(400).json({ message: 'معرف الدفعة غير صالح' });
    if (status !== undefined && !['redeemed', 'available'].includes(status)) return res.status(400).json({ message: 'حالة البطاقة غير صالحة' });
    const filter = { ...getTenantFilter(req) };
    if (batchId) filter.batchId = batchId.trim();
    if (status === 'redeemed') filter.isRedeemed = true;
    if (status === 'available') filter.isRedeemed = false;
    const [cards, batches] = await Promise.all([
      ScratchCard.find(filter).select('-code_hash').populate('redeemedBy', 'name').sort({ createdAt: -1 }).limit(1000),
      ScratchCard.aggregate([
        { $match: { ...getTenantFilter(req), ...(batchId ? { batchId: batchId.trim() } : {}) } },
        { $group: { _id: '$batchId', total: { $sum: 1 }, redeemed: { $sum: { $cond: ['$isRedeemed', 1, 0] } }, value: { $first: '$value' }, createdAt: { $min: '$createdAt' } } },
        { $sort: { createdAt: -1 } }
      ])
    ]);
    res.json({ data: { cards, batches } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/scratchcards/redeem
// Marks a card redeemed atomically, then credits the authenticated student's wallet.
exports.redeemScratchCard = async (req, res, next) => {
  try {
    const body = req.body;
    const GENERIC_ERROR = { message: 'البطاقة غير صالحة أو تم استخدامها بالفعل' };

    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.code !== 'string' || !body.code.trim() || body.code.length > 64) {
      return res.status(400).json(GENERIC_ERROR);
    }
    if (!hasTenant(req)) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const tenantFilter = getTenantFilter(req);
    const scratchCard = await ScratchCard.findOneAndUpdate(
      { ...tenantFilter, code_hash: hashCode(body.code.trim()), isRedeemed: false },
      { $set: { isRedeemed: true, redeemedBy: req.user._id, redeemedAt: new Date() } },
      { new: true }
    );
    if (!scratchCard) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const student = await User.findOneAndUpdate(
      { _id: req.user._id, ...tenantFilter },
      { $inc: { walletBalance: scratchCard.value } },
      { new: true }
    );
    if (!student) {
      return next(new Error('Unable to credit the wallet'));
    }

    await Transaction.create({
      tenantId: scratchCard.tenantId,
      userId: req.user._id,
      type: 'topup',
      source: 'scratchcard',
      amount: scratchCard.value,
      status: 'success'
    });

    res.json({ data: { walletBalance: student.walletBalance } });
  } catch (err) {
    next(err);
  }
};
