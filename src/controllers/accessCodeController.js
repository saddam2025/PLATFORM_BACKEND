const crypto = require('crypto');
const AccessCode = require('../models/AccessCode');
const Course = require('../models/Course');
const LectureAccess = require('../models/LectureAccess');
const Transaction = require('../models/Transaction');
const { generateBatch, hashCode } = require('../utils/generateCode');

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

// POST /api/v1/instructors/:instructorId/courses/:courseId/access-codes/generate
// protect + authorize('admin','assistant') + requirePermission('can_generate_access_codes').
exports.generateAccessCodes = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;
    const { count, batchId } = req.body;

    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتوليد أكواد لهذا الحساب' });
    }

    const course = await Course.findOne({ _id: courseId, instructorId, ...req.tenantFilter });
    if (!course) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    const n = Number(count);
    if (!n || n < 1 || n > 1000) {
      return res.status(400).json({ message: 'عدد الأكواد غير صالح' });
    }

    const resolvedBatchId = batchId || crypto.randomBytes(4).toString('hex');
    const { plaintextCodes, hashedCodes } = generateBatch(n);

    const docs = hashedCodes.map((hash) => ({
      tenantId: req.user.tenantId,
      code_hash: hash,
      courseId,
      instructorId,
      generatedBy: req.user._id,
      batchId: resolvedBatchId
    }));

    await AccessCode.insertMany(docs);

    // Same "reveal once" pattern as scratch cards — plaintext exists only
    // in this response, never persisted.
    res.status(201).json({
      data: {
        batchId: resolvedBatchId,
        count: n,
        courseId,
        codes: plaintextCodes
      }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/access-codes/redeem
// protect + authorize('student'). Body: { code }.
exports.redeemAccessCode = async (req, res, next) => {
  try {
    const { code } = req.body;
    const GENERIC_ERROR = { message: 'الكود غير صالح' };

    if (!code) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const hash = hashCode(code.trim());
    const accessCode = await AccessCode.findOne({ code_hash: hash, ...req.tenantFilter });

    // Same deliberate generic error for "doesn't exist" / "already
    // redeemed" / "wrong instructor" — no information leak via error
    // message differences.
    if (!accessCode || accessCode.isRedeemed) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const course = await Course.findOne({ _id: accessCode.courseId, ...req.tenantFilter });
    if (!course) {
      return res.status(400).json(GENERIC_ERROR);
    }

    accessCode.isRedeemed = true;
    accessCode.redeemedBy = req.user._id;
    accessCode.redeemedAt = new Date();
    await accessCode.save();

    // This closes the B5 dependency — B5's start-view endpoint only READS
    // LectureAccess; this is one of the two places (the other being the
    // Paymob webhook below) that actually CREATES it.
    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt);
    expiresAt.setDate(expiresAt.getDate() + course.accessPeriodDays);

    // Guard against a double-redeem race creating a duplicate LectureAccess
    // (the unique index on studentId+courseId would reject it anyway, but
    // upsert here makes redeeming a second, different code for a course
    // already owned a safe no-op rather than an unhandled 500).
    await LectureAccess.findOneAndUpdate(
      { studentId: req.user._id, courseId: course._id, ...req.tenantFilter },
      {
        $setOnInsert: {
          tenantId: req.user.tenantId,
          purchasedAt,
          expiresAt,
          maxViews: course.maxViews,
          viewsUsed: 0
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Transaction.create({
      tenantId: req.user.tenantId,
      userId: req.user._id,
      type: 'purchase',
      source: 'access_code',
      amount: 0,
      relatedCourseId: course._id,
      status: 'success'
    });

    res.json({ data: { courseId: course._id, expiresAt, maxViews: course.maxViews } });
  } catch (err) {
    next(err);
  }
};
