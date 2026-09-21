const mongoose = require('mongoose');
const { uploadImageFile } = require('../utils/r2Upload');
const StandaloneExam = require('../models/StandaloneExam');
const User = require('../models/User');
const StandaloneExamSubmission = require('../models/StandaloneExamSubmission');
const { STAGE_ENUM } = require('../constants/stages');
const gradeSubmission = require('../utils/gradeQuiz');
const { expiresAtFor, settleExpiredSubmission, settleExpiredStandaloneExamSubmissions } = require('../services/standaloneExamSubmissionService');
const { hasSafeMathSegments } = require('../utils/validateMathText');

function getTenantFilter(req) {
  return req.tenantFilter || { tenantId: req.user.tenantId };
}

function isOwnerOfInstructor(user, instructorId) {
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

async function assertManagedInstructor(req, instructorId) {
  if (!mongoose.isValidObjectId(instructorId)) return { error: 'معرف المدرس غير صالح', status: 400 };
  if (!isOwnerOfInstructor(req.user, instructorId)) return { error: 'غير مصرح لك بإدارة اختبارات هذا الحساب', status: 403 };
  const instructor = await User.findOne({ _id: instructorId, role: 'admin', ...getTenantFilter(req) }).select('_id').lean();
  return instructor ? { instructor } : { error: 'المدرس غير موجود', status: 404 };
}

function parseQuestions(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const questions = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const stemType = item.stemType === 'image' ? 'image' : 'text';
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const imageUrl = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '';
    const options = Array.isArray(item.options) ? item.options.map((option) => typeof option === 'string' ? option.trim() : '') : [];
    const correctOptionIndex = Number(item.correctOptionIndex);
    const points = Number(item.points);
    if ((stemType === 'text' && (!text || text.length > 1000 || !hasSafeMathSegments(text))) || (stemType === 'image' && (!imageUrl || imageUrl.length > 2000)) || options.length !== 4 || options.some((option) => !option || option.length > 500 || !hasSafeMathSegments(option)) || !Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex > 3 || !Number.isFinite(points) || points <= 0) return null;
    questions.push({ text: stemType === 'text' ? text : '', stemType, imageUrl: stemType === 'image' ? imageUrl : null, options, correctOptionIndex, points });
  }
  return questions;
}

function parseExamFields(body, { creating = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'بيانات الامتحان غير صالحة' };
  const fields = {};
  if (creating || body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 200) return { error: 'عنوان الامتحان غير صالح' };
    fields.title = title;
  }
  if (creating || body.stage !== undefined) {
    if (!STAGE_ENUM.includes(body.stage)) return { error: 'المرحلة الدراسية غير صالحة' };
    fields.stage = body.stage;
  }
  if (creating || body.durationMinutes !== undefined) {
    const durationMinutes = Number(body.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) return { error: 'مدة الامتحان غير صالحة' };
    fields.durationMinutes = durationMinutes;
  }
  if (creating || body.questions !== undefined) {
    const questions = parseQuestions(body.questions);
    if (!questions) return { error: 'أسئلة الامتحان غير صالحة' };
    fields.questions = questions;
  }
  if (body.thumbnailUrl !== undefined) {
    if (body.thumbnailUrl !== null && (typeof body.thumbnailUrl !== 'string' || body.thumbnailUrl.trim().length > 2000)) return { error: 'رابط الصورة غير صالح' };
    fields.thumbnailUrl = body.thumbnailUrl ? body.thumbnailUrl.trim() : null;
  }
  return { fields };
}

async function findManagedExam(req, instructorId, examId) {
  const managed = await assertManagedInstructor(req, instructorId);
  if (managed.error) return managed;
  if (!mongoose.isValidObjectId(examId)) return { error: 'معرف الامتحان غير صالح', status: 400 };
  const exam = await StandaloneExam.findOne({ _id: examId, ...getTenantFilter(req) });
  return exam ? { exam } : { error: 'الامتحان غير موجود', status: 404 };
}

// POST /api/v1/instructors/:instructorId/exams
exports.createStandaloneExam = async (req, res, next) => {
  try {
    const managed = await assertManagedInstructor(req, req.params.instructorId);
    if (managed.error) return res.status(managed.status).json({ message: managed.error });
    const parsed = parseExamFields(req.body, { creating: true });
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const thumbnailUrl = req.files?.thumbnail?.[0] ? await uploadImageFile(req.files.thumbnail[0], 'thumbnails', 'Exam thumbnail') : parsed.fields.thumbnailUrl;
    const exam = await StandaloneExam.create({ ...parsed.fields, thumbnailUrl, tenantId: req.user.tenantId, createdBy: req.user._id, status: 'draft' });
    return res.status(201).json({ data: exam });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/exams
exports.listManagedStandaloneExams = async (req, res, next) => {
  try {
    const managed = await assertManagedInstructor(req, req.params.instructorId);
    if (managed.error) return res.status(managed.status).json({ message: managed.error });
    const exams = await StandaloneExam.find(getTenantFilter(req)).sort({ updatedAt: -1 }).populate('createdBy', 'name').lean();
    return res.json({ data: exams });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/instructors/:instructorId/exams/:examId
exports.updateStandaloneExam = async (req, res, next) => {
  try {
    const found = await findManagedExam(req, req.params.instructorId, req.params.examId);
    if (found.error) return res.status(found.status).json({ message: found.error });
    const parsed = parseExamFields(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    if (Object.keys(parsed.fields).length === 0) return res.status(400).json({ message: 'لا توجد بيانات لتحديثها' });
    const thumbnailUrl = req.files?.thumbnail?.[0] ? await uploadImageFile(req.files.thumbnail[0], 'thumbnails', 'Exam thumbnail') : parsed.fields.thumbnailUrl;
    Object.assign(found.exam, { ...parsed.fields, ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}) });
    await found.exam.save();
    return res.json({ data: found.exam });
  } catch (err) {
    next(err);
  }
};

async function setExamStatus(req, res, next, status) {
  try {
    const found = await findManagedExam(req, req.params.instructorId, req.params.examId);
    if (found.error) return res.status(found.status).json({ message: found.error });
    found.exam.status = status;
    await found.exam.save();
    return res.json({ data: found.exam });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/v1/instructors/:instructorId/exams/:examId/publish
exports.publishStandaloneExam = (req, res, next) => setExamStatus(req, res, next, 'published');

// PATCH /api/v1/instructors/:instructorId/exams/:examId/close
exports.closeStandaloneExam = (req, res, next) => setExamStatus(req, res, next, 'closed');

// DELETE /api/v1/instructors/:instructorId/exams/:examId
exports.deleteStandaloneExam = async (req, res, next) => {
  try {
    const found = await findManagedExam(req, req.params.instructorId, req.params.examId);
    if (found.error) return res.status(found.status).json({ message: found.error });
    await found.exam.deleteOne();
    return res.status(204).end();
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/exams/available
exports.listAvailableStandaloneExams = async (req, res, next) => {
  try {
    if (!req.user.stage || !STAGE_ENUM.includes(req.user.stage)) return res.json({ data: [] });
    await settleExpiredStandaloneExamSubmissions({ filter: { studentId: req.user._id, ...getTenantFilter(req) } });
    const exams = await StandaloneExam.find({ status: 'published', stage: req.user.stage, ...getTenantFilter(req) })
      // Question content and answer keys are deliberately withheld until a
      // future start-exam endpoint can create the one allowed submission.
      .select('title thumbnailUrl stage durationMinutes status createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ data: exams });
  } catch (err) {
    next(err);
  }
};

function parseAnswers(value, questionCount) {
  if (!Array.isArray(value) || value.length > questionCount) return null;
  if (!value.every((answer) => Number.isInteger(answer) && answer >= 0 && answer <= 3)) return null;
  return value;
}

function studentExamPayload(exam) {
  return {
    id: exam._id,
    title: exam.title,
    thumbnailUrl: exam.thumbnailUrl || null,
    stage: exam.stage,
    durationMinutes: exam.durationMinutes,
    questions: exam.questions.map((question) => ({
      id: question._id,
      text: question.text,
      stemType: question.stemType || 'text',
      imageUrl: question.imageUrl || null,
      options: question.options,
      points: question.points
    }))
  };
}

async function findStartableExam(req) {
  if (!mongoose.isValidObjectId(req.params.examId)) return null;
  // A single 404 covers wrong tenant, stage, and status, avoiding disclosure
  // of an exam that the student is not allowed to start.
  return StandaloneExam.findOne({
    _id: req.params.examId,
    status: 'published',
    stage: req.user.stage,
    ...getTenantFilter(req)
  });
}

// POST /api/v1/exams/:examId/start
exports.startStandaloneExam = async (req, res, next) => {
  try {
    const exam = await findStartableExam(req);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير متاح' });

    const existing = await StandaloneExamSubmission.findOne({ examId: exam._id, studentId: req.user._id, ...getTenantFilter(req) });
    if (existing) {
      await settleExpiredSubmission(existing, exam);
      return res.status(409).json({ message: 'لقد بدأت أو أنهيت هذه المحاولة بالفعل؛ لا توجد إعادة للمحاولة' });
    }

    let submission;
    try {
      submission = await StandaloneExamSubmission.create({ tenantId: req.user.tenantId, examId: exam._id, studentId: req.user._id, startedAt: new Date() });
    } catch (err) {
      if (err?.code === 11000) return res.status(409).json({ message: 'لقد بدأت أو أنهيت هذه المحاولة بالفعل؛ لا توجد إعادة للمحاولة' });
      throw err;
    }
    return res.status(201).json({ data: { submission: { id: submission._id, startedAt: submission.startedAt, expiresAt: expiresAtFor(exam, submission.startedAt) }, exam: studentExamPayload(exam) } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/exams/:examId/submit
exports.submitStandaloneExam = async (req, res, next) => {
  try {
    const exam = await findStartableExam(req);
    if (!exam) return res.status(404).json({ message: 'الامتحان غير متاح' });
    const submission = await StandaloneExamSubmission.findOne({ examId: exam._id, studentId: req.user._id, ...getTenantFilter(req) });
    if (!submission) return res.status(404).json({ message: 'لم تبدأ هذا الامتحان' });
    if (submission.submittedAt) return res.status(409).json({ message: 'تم تسليم هذه المحاولة بالفعل', data: { score: submission.score, autoSubmitted: submission.autoSubmitted } });

    const answers = parseAnswers(req.body?.answers, exam.questions.length);
    if (!answers) return res.status(400).json({ message: 'الإجابات غير صالحة' });

    const now = new Date();
    if (now >= expiresAtFor(exam, submission.startedAt)) {
      // A late request may contain answers, but is recorded as an automatic
      // expiry result rather than an on-time manual submission.
      const { score } = gradeSubmission(exam, answers);
      const submittedAt = expiresAtFor(exam, submission.startedAt);
      const finalized = await StandaloneExamSubmission.findOneAndUpdate(
        { _id: submission._id, submittedAt: null },
        { $set: { answers, score, submittedAt, autoSubmitted: true } },
        { new: true }
      );
      if (!finalized) return res.status(409).json({ message: 'تم تسليم هذه المحاولة بالفعل' });
      return res.status(200).json({ data: { submissionId: finalized._id, score, submittedAt: finalized.submittedAt, autoSubmitted: true } });
    }

    const { score } = gradeSubmission(exam, answers);
    const finalized = await StandaloneExamSubmission.findOneAndUpdate(
      { _id: submission._id, submittedAt: null },
      { $set: { answers, score, submittedAt: now, autoSubmitted: false } },
      { new: true }
    );
    if (!finalized) return res.status(409).json({ message: 'تم تسليم هذه المحاولة بالفعل' });
    return res.json({ data: { submissionId: finalized._id, score, submittedAt: finalized.submittedAt, autoSubmitted: false } });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/students/me/exam-scores
exports.listMyStandaloneExamScores = async (req, res, next) => {
  try {
    const filter = { studentId: req.user._id, ...getTenantFilter(req) };
    await settleExpiredStandaloneExamSubmissions({ filter });
    const submissions = await StandaloneExamSubmission.find(filter).sort({ startedAt: -1 }).lean();
    const examIds = [...new Set(submissions.map((submission) => String(submission.examId)))];
    const exams = examIds.length ? await StandaloneExam.find({ _id: { $in: examIds }, ...getTenantFilter(req) }).select('title stage durationMinutes thumbnailUrl').lean() : [];
    const examsById = new Map(exams.map((exam) => [String(exam._id), exam]));
    return res.json({ data: submissions.map((submission) => ({
      id: submission._id, examId: submission.examId, exam: examsById.get(String(submission.examId)) || null,
      startedAt: submission.startedAt, submittedAt: submission.submittedAt, score: submission.score, autoSubmitted: submission.autoSubmitted
    })) });
  } catch (err) {
    next(err);
  }
};
