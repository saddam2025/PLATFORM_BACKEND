const crypto = require('crypto');
const mongoose = require('mongoose');
const AccessCode = require('../models/AccessCode');
const Course = require('../models/Course');
const LectureAccess = require('../models/LectureAccess');
const Lecture = require('../models/Lecture');
const { grantCourseEnrollment, grantLectureAccess } = require('../utils/grantLearningAccess');
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
    const { count, batchId, type = 'full_course', lectureId } = req.body;

    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتوليد أكواد لهذا الحساب' });
    }

    const course = await Course.findOne({ _id: courseId, instructorId, ...req.tenantFilter });
    if (!course) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }
    if (!['full_course', 'single_lecture'].includes(type)) return res.status(400).json({ message: 'نوع الكود غير صالح' });
    const lecture = type === 'single_lecture' ? await Lecture.findOne({ _id: lectureId, courseId, instructorId, ...req.tenantFilter }) : null;
    if (type === 'single_lecture' && !lecture) return res.status(404).json({ message: 'المحاضرة غير موجودة' });

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
      lectureId: lecture?._id || null,
      type,
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
        lectureId: lecture?._id || null,
        type,
        codes: plaintextCodes
      }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/access-codes/redeem
// protect + authorize('student'). Body may include an expected course or
// lecture target so a checkout screen never consumes a valid code meant for
// another item.
exports.redeemAccessCode = async (req, res, next) => {
  try {
    const { code, expectedCourseId, expectedLectureId } = req.body;
    const GENERIC_ERROR = { message: 'الكود غير صالح' };

    if (!code) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const targetFilter = {};
    if (expectedCourseId) {
      if (!mongoose.isValidObjectId(expectedCourseId)) return res.status(400).json(GENERIC_ERROR);
      targetFilter.courseId = expectedCourseId;
    }
    if (expectedLectureId) {
      if (!mongoose.isValidObjectId(expectedLectureId)) return res.status(400).json(GENERIC_ERROR);
      targetFilter.type = 'single_lecture';
      targetFilter.lectureId = expectedLectureId;
    } else if (expectedCourseId) {
      targetFilter.type = 'full_course';
    }

    const hash = hashCode(code.trim());
    const accessCode = await AccessCode.findOneAndUpdate(
      { code_hash: hash, ...req.tenantFilter, isRedeemed: false, ...targetFilter },
      { $set: { isRedeemed: true, redeemedBy: req.user._id, redeemedAt: new Date() } },
      { new: true }
    );
    if (!accessCode) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const course = await Course.findOne({ _id: accessCode.courseId, isPublished: true, ...req.tenantFilter });
    if (!course) {
      return res.status(400).json(GENERIC_ERROR);
    }

    const lecture = accessCode.type === 'single_lecture' ? await Lecture.findOne({ _id: accessCode.lectureId, courseId: course._id, ...req.tenantFilter }) : null;
    if (accessCode.type === 'single_lecture' && !lecture) return res.status(400).json(GENERIC_ERROR);
    const access = accessCode.type === 'single_lecture'
      ? await grantLectureAccess({ lecture, studentId: req.user._id, tenantId: req.user.tenantId })
      : await grantCourseEnrollment({ course, studentId: req.user._id, tenantId: req.user.tenantId, source: 'access_code' });

    await Transaction.create({
      tenantId: req.user.tenantId,
      userId: req.user._id,
      type: 'purchase',
      source: 'access_code',
      amount: 0,
      relatedCourseId: course._id,
      relatedLectureId: lecture?._id || null,
      status: 'success'
    });

    res.json({ data: { type: accessCode.type, courseId: course._id, lectureId: lecture?._id || null, access } });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/access-code-batches
// Lists aggregate batch metadata only. Plaintext codes are never recoverable.
exports.listAccessCodeBatches = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    if (!mongoose.isValidObjectId(instructorId)) return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض أكواد هذا الحساب' });
    }

    const batches = await AccessCode.aggregate([
      { $match: { instructorId: new mongoose.Types.ObjectId(instructorId), ...req.tenantFilter } },
      {
        $group: {
          _id: { batchId: '$batchId', type: '$type', courseId: '$courseId', lectureId: '$lectureId' },
          total: { $sum: 1 },
          redeemed: { $sum: { $cond: ['$isRedeemed', 1, 0] } },
          createdAt: { $min: '$createdAt' },
          updatedAt: { $max: '$updatedAt' }
        }
      },
      { $lookup: { from: 'courses', localField: '_id.courseId', foreignField: '_id', as: 'course' } },
      { $lookup: { from: 'lectures', localField: '_id.lectureId', foreignField: '_id', as: 'lecture' } },
      {
        $project: {
          _id: 0, batchId: '$_id.batchId', type: '$_id.type', courseId: '$_id.courseId', lectureId: '$_id.lectureId',
          total: 1, redeemed: 1, available: { $subtract: ['$total', '$redeemed'] }, createdAt: 1, updatedAt: 1,
          course: { $arrayElemAt: ['$course', 0] }, lecture: { $arrayElemAt: ['$lecture', 0] }
        }
      },
      { $sort: { createdAt: -1 } }
    ]);
    res.json({ data: batches });
  } catch (err) { next(err); }
};
