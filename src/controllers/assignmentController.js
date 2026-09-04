const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Course = require('../models/Course');
const LectureProgress = require('../models/LectureProgress');
const createNotificationsForAudience = require('../utils/createNotification');

function getTenantFilter(req) {
  return req.tenantFilter || (req.user.tenantId ? { tenantId: req.user.tenantId } : {});
}

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

async function getCourse(req, courseId) {
  if (!mongoose.isValidObjectId(courseId)) return null;
  return Course.findOne({ _id: courseId, ...getTenantFilter(req) });
}

function assignmentFileUrl(file) {
  return file ? `/uploads/assignments/${file.filename}` : null;
}

// POST /api/v1/courses/:courseId/assignments/submit
// Creates or replaces the authenticated student's one submission for a
// course. studentId and tenantId are always derived from the authenticated
// request, never from multipart form fields.
exports.submitAssignment = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const submissionNote = typeof req.body?.submissionNote === 'string' ? req.body.submissionNote.trim() : '';

    if (submissionNote.length > 5000) {
      return res.status(400).json({ message: 'ملاحظة التسليم طويلة جداً' });
    }
    if (!req.file && !submissionNote) {
      return res.status(400).json({ message: 'أرفق ملفاً أو أضف ملاحظة للتسليم' });
    }

    const course = await getCourse(req, courseId);
    if (!course) return res.status(404).json({ message: 'الدورة غير موجودة' });

    const filter = { courseId: course._id, studentId: req.user._id, ...getTenantFilter(req) };
    const update = {
      $set: {
        submissionNote,
        status: 'pending',
        grade: null,
        feedback: '',
        submittedAt: new Date()
      },
      $setOnInsert: { tenantId: course.tenantId, studentId: req.user._id, courseId: course._id }
    };
    if (req.file) update.$set.submissionFileUrl = assignmentFileUrl(req.file);

    const assignment = await Assignment.findOneAndUpdate(filter, update, {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true
    });

    // This is the progress signal used by CourseController's next-lecture
    // lock calculation; it is scoped to the same student/course/tenant.
    await LectureProgress.findOneAndUpdate(
      { studentId: req.user._id, courseId: course._id, ...getTenantFilter(req) },
      { $set: { homeworkCompleted: true }, $setOnInsert: { tenantId: course.tenantId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ data: assignment });
  } catch (err) {
    // The compound index is a final guard against simultaneous submits.
    if (err.code === 11000) {
      return res.status(409).json({ message: 'تم إرسال التسليم بالتزامن؛ أعد المحاولة' });
    }
    next(err);
  }
};

// GET /api/v1/courses/:courseId/assignments/mine
exports.getMyAssignment = async (req, res, next) => {
  try {
    const course = await getCourse(req, req.params.courseId);
    if (!course) return res.status(404).json({ message: 'الدورة غير موجودة' });

    const assignment = await Assignment.findOne({
      courseId: course._id,
      studentId: req.user._id,
      ...getTenantFilter(req)
    });
    res.json({ data: assignment || null });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/assignments/pending
exports.getPendingAssignments = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    if (!mongoose.isValidObjectId(instructorId)) return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض قائمة واجبات هذا الحساب' });
    }

    const assignments = await Assignment.find({ status: 'pending', ...getTenantFilter(req) })
      .populate({ path: 'courseId', match: { instructorId, ...getTenantFilter(req) }, select: 'title_ar title_en instructorId' })
      .populate({ path: 'studentId', select: 'name email' })
      .sort({ submittedAt: 1 });

    // A tenant can theoretically contain several instructors, so population
    // matching is not enough: remove assignments whose course is another
    // instructor's before returning the queue.
    const data = assignments.filter((assignment) => assignment.courseId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/assignments/:id
exports.getAssignment = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرف الواجب غير صالح' });
    const assignment = await Assignment.findOne({ _id: req.params.id, ...getTenantFilter(req) })
      .populate('courseId', 'title_ar title_en instructorId')
      .populate('studentId', 'name email');
    if (!assignment || !assignment.courseId) return res.status(404).json({ message: 'الواجب غير موجود' });

    const isStudentOwner = req.user.role === 'student' && String(assignment.studentId._id) === String(req.user._id);
    if (!isStudentOwner && !isOwnerOfInstructor(req.user, assignment.courseId.instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض هذا الواجب' });
    }
    res.json({ data: assignment });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/assignments/:id/grade
exports.gradeAssignment = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرف الواجب غير صالح' });
    const { status, feedback } = req.body || {};
    if (!['graded', 'resubmit'].includes(status)) {
      return res.status(400).json({ message: 'حالة التقييم غير صالحة' });
    }
    if (typeof feedback !== 'string' || feedback.trim().length > 5000) {
      return res.status(400).json({ message: 'ملاحظات التقييم غير صالحة' });
    }
    const grade = req.body.grade;
    if (status === 'graded' && (!Number.isFinite(grade) || grade < 0 || grade > 100)) {
      return res.status(400).json({ message: 'الدرجة يجب أن تكون رقماً بين 0 و100' });
    }

    const assignment = await Assignment.findOne({ _id: req.params.id, ...getTenantFilter(req) }).populate('courseId', 'title_ar instructorId');
    if (!assignment || !assignment.courseId) return res.status(404).json({ message: 'الواجب غير موجود' });
    if (!isOwnerOfInstructor(req.user, assignment.courseId.instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتصحيح هذا الواجب' });
    }

    assignment.status = status;
    assignment.grade = status === 'graded' ? grade : null;
    assignment.feedback = feedback.trim();
    await assignment.save();

    await createNotificationsForAudience({
      tenantId: assignment.tenantId,
      instructorId: assignment.courseId.instructorId,
      type: 'assignment_graded',
      title: status === 'graded' ? 'تم تصحيح الواجب' : 'مطلوب إعادة تسليم الواجب',
      body: status === 'graded'
        ? `تم تصحيح واجب ${assignment.courseId.title_ar}. درجتك: ${assignment.grade}`
        : `يرجى إعادة تسليم واجب ${assignment.courseId.title_ar} بعد مراجعة الملاحظات.`,
      relatedId: assignment._id,
      recipientIds: assignment.studentId
    });

    res.json({ data: assignment });
  } catch (err) {
    next(err);
  }
};
