const Quiz = require('../models/Quiz');
const QuizSubmission = require('../models/QuizSubmission');
const LectureProgress = require('../models/LectureProgress');
const Course = require('../models/Course');
const Subscription = require('../models/Subscription');
const gradeSubmission = require('../utils/gradeQuiz');
const createNotificationsForAudience = require('../utils/createNotification');
const mongoose = require('mongoose');

// OWASP A01/A03-adjacent: never send correctOptionIndex or explanation to
// the client before a submission exists — a student holding the answer key
// in the initial payload can trivially "pass" regardless of what the
// frontend chooses to render.
function stripAnswerKey(quiz) {
  const plain = quiz.toObject ? quiz.toObject() : quiz;
  return {
    ...plain,
    questions: plain.questions.map((q) => ({
      _id: q._id,
      text: q.text,
      options: q.options,
      points: q.points
      // correctOptionIndex and explanation intentionally omitted
    }))
  };
}

function currentMonthString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

function getTenantFilter(req) {
  return req.tenantFilter || (req.user.tenantId ? { tenantId: req.user.tenantId } : {});
}

function normalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const normalized = [];
  for (const question of questions) {
    if (!question || typeof question !== 'object' || Array.isArray(question)) return null;
    const text = typeof question.text === 'string' ? question.text.trim() : '';
    const options = Array.isArray(question.options) ? question.options.map((option) => typeof option === 'string' ? option.trim() : '') : [];
    const correctOptionIndex = question.correctOptionIndex;
    const points = Number(question.points);
    if (!text || options.length !== 4 || options.some((option) => !option) || !Number.isInteger(correctOptionIndex) || correctOptionIndex < 0 || correctOptionIndex > 3 || !Number.isFinite(points) || points <= 0) {
      return null;
    }
    normalized.push({
      text,
      options,
      correctOptionIndex,
      points,
      explanation: typeof question.explanation === 'string' ? question.explanation.trim() : ''
    });
  }
  return normalized;
}

async function getOwnedCourse(req, instructorId, courseId) {
  if (!mongoose.isValidObjectId(instructorId) || !mongoose.isValidObjectId(courseId)) return null;
  if (!isOwnerOfInstructor(req.user, instructorId)) return false;
  return Course.findOne({ _id: courseId, instructorId, ...getTenantFilter(req) });
}

// GET /api/v1/instructors/:instructorId/courses/:courseId/quiz
// Authoring-only endpoint. Unlike the student endpoint, this intentionally
// returns answer keys and explanations to the course owner.
exports.getCourseQuizForEditing = async (req, res, next) => {
  try {
    const course = await getOwnedCourse(req, req.params.instructorId, req.params.courseId);
    if (course === false) return res.status(403).json({ message: 'غير مصرح لك بإدارة اختبارات هذا الحساب' });
    if (!course) return res.status(404).json({ message: 'الدورة غير موجودة' });
    const quiz = await Quiz.findOne({ courseId: course._id, type: 'lecture', ...getTenantFilter(req) });
    res.json({ data: quiz || null });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/instructors/:instructorId/courses/:courseId/quiz
exports.createCourseQuiz = async (req, res, next) => {
  try {
    const course = await getOwnedCourse(req, req.params.instructorId, req.params.courseId);
    if (course === false) return res.status(403).json({ message: 'غير مصرح لك بإدارة اختبارات هذا الحساب' });
    if (!course) return res.status(404).json({ message: 'الدورة غير موجودة' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const questions = normalizeQuestions(req.body?.questions);
    const passingScore = Number(req.body?.passingScore);
    const timeLimitMinutes = req.body?.timeLimitMinutes == null ? null : Number(req.body.timeLimitMinutes);
    if (!title || title.length > 200 || !questions || !Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100 || (timeLimitMinutes !== null && (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1))) {
      return res.status(400).json({ message: 'بيانات الاختبار أو الأسئلة غير صالحة' });
    }
    if (await Quiz.exists({ courseId: course._id, type: 'lecture', ...getTenantFilter(req) })) {
      return res.status(409).json({ message: 'يوجد اختبار لهذه الدورة بالفعل؛ استخدم التعديل بدلاً من الإنشاء' });
    }
    const quiz = await Quiz.create({
      tenantId: course.tenantId,
      courseId: course._id,
      instructorId: course.instructorId,
      type: 'lecture',
      title,
      questions,
      passingScore,
      timeLimitMinutes
    });
    course.quizId = quiz._id;
    await course.save();
    res.status(201).json({ data: quiz });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/quizzes/:id
exports.updateCourseQuiz = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرف الاختبار غير صالح' });
    const quiz = await Quiz.findOne({ _id: req.params.id, type: 'lecture', ...getTenantFilter(req) });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });
    const course = await Course.findOne({ _id: quiz.courseId, instructorId: quiz.instructorId, ...getTenantFilter(req) });
    if (!course) return res.status(404).json({ message: 'الدورة غير موجودة' });
    if (!isOwnerOfInstructor(req.user, course.instructorId)) return res.status(403).json({ message: 'غير مصرح لك بتعديل هذا الاختبار' });

    if (req.body.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 200) return res.status(400).json({ message: 'عنوان الاختبار غير صالح' });
      quiz.title = req.body.title.trim();
    }
    if (req.body.passingScore !== undefined) {
      const passingScore = Number(req.body.passingScore);
      if (!Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100) return res.status(400).json({ message: 'نسبة النجاح غير صالحة' });
      quiz.passingScore = passingScore;
    }
    if (req.body.timeLimitMinutes !== undefined) {
      const timeLimitMinutes = req.body.timeLimitMinutes === null ? null : Number(req.body.timeLimitMinutes);
      if (timeLimitMinutes !== null && (!Number.isInteger(timeLimitMinutes) || timeLimitMinutes < 1)) return res.status(400).json({ message: 'مدة الاختبار غير صالحة' });
      quiz.timeLimitMinutes = timeLimitMinutes;
    }
    if (req.body.questions !== undefined) {
      if (await QuizSubmission.exists({ quizId: quiz._id, ...getTenantFilter(req) })) {
        return res.status(409).json({ message: 'لا يمكن تعديل أسئلة اختبار له محاولات طلاب؛ حفاظاً على سجل النتائج والإعادة' });
      }
      const questions = normalizeQuestions(req.body.questions);
      if (!questions) return res.status(400).json({ message: 'أسئلة الاختبار غير صالحة' });
      quiz.questions = questions;
    }
    await quiz.save();
    res.json({ data: quiz });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/quizzes/:id
// Quizzes with submissions are deliberately retained: retries and historical
// result views dereference the original question set and cannot be preserved
// safely by a hard delete.
exports.deleteCourseQuiz = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'معرف الاختبار غير صالح' });
    const quiz = await Quiz.findOne({ _id: req.params.id, type: 'lecture', ...getTenantFilter(req) });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });
    const course = await Course.findOne({ _id: quiz.courseId, instructorId: quiz.instructorId, ...getTenantFilter(req) });
    if (!course) return res.status(404).json({ message: 'الدورة غير موجودة' });
    if (!isOwnerOfInstructor(req.user, course.instructorId)) return res.status(403).json({ message: 'غير مصرح لك بحذف هذا الاختبار' });
    if (await QuizSubmission.exists({ quizId: quiz._id, ...getTenantFilter(req) })) {
      return res.status(409).json({ message: 'لا يمكن حذف اختبار له محاولات طلاب؛ حفاظاً على سجل النتائج' });
    }
    await Quiz.deleteOne({ _id: quiz._id, ...getTenantFilter(req) });
    if (String(course.quizId) === String(quiz._id)) {
      course.quizId = null;
      await course.save();
    }
    res.json({ data: { id: quiz._id, deleted: true } });
  } catch (err) {
    next(err);
  }
};

async function getMonthlyExamEligibility(quiz, user, tenantFilter) {
  const missingRequirements = [];
  const month = currentMonthString();

  if (quiz.month !== month) {
    return { eligible: false, reason: 'هذا الاختبار ليس اختبار الشهر الحالي', missingRequirements: ['current_month_exam'] };
  }

  const subscription = await Subscription.findOne({
    studentId: user._id,
    instructorId: quiz.instructorId,
    stage: quiz.stage,
    month: quiz.month,
    status: { $in: ['active', 'pending_exam'] },
    ...tenantFilter
  });
  if (!subscription) {
    return { eligible: false, reason: 'لا يوجد اشتراك صالح لهذا الاختبار', missingRequirements: ['active_subscription'] };
  }
  if (subscription.monthlyExamPassed) {
    return { eligible: false, reason: 'تم اجتياز اختبار الشهر بالفعل', missingRequirements: ['exam_not_already_passed'] };
  }

  const prerequisites = quiz.prerequisiteQuizIds || [];
  if (prerequisites.length) {
    const passedQuizIds = await QuizSubmission.distinct('quizId', {
      studentId: user._id,
      quizId: { $in: prerequisites },
      passed: true,
      ...tenantFilter
    });
    const passed = new Set(passedQuizIds.map(String));
    missingRequirements.push(...prerequisites.filter((id) => !passed.has(String(id))).map(String));
  }

  return {
    eligible: missingRequirements.length === 0,
    reason: missingRequirements.length === 0 ? 'تم استيفاء جميع المتطلبات' : 'لم يتم اجتياز جميع الاختبارات المطلوبة',
    missingRequirements
  };
}

// GET /api/v1/quizzes/:quizId
exports.getQuiz = async (req, res, next) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.quizId, ...req.tenantFilter });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });
    if (req.user.role === 'student' && quiz.type === 'monthly_exam') {
      const eligibility = await getMonthlyExamEligibility(quiz, req.user, req.tenantFilter);
      if (!eligibility.eligible) return res.status(403).json({ message: eligibility.reason, ...eligibility });
    }
    res.json({ data: stripAnswerKey(quiz) });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/quizzes/:quizId/submit
// protect + authorize('student'). This endpoint is for regular LECTURE
// quizzes only (quiz.courseId set) — monthly exams go through
// subscriptionController's dedicated submit endpoint instead.
exports.submitQuiz = async (req, res, next) => {
  try {
    const { quizId } = req.params;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: 'إجابات غير صالحة' });
    }

    // Load the FULL quiz server-side including the answer key — never trust
    // a client-supplied answer key or score.
    const quiz = await Quiz.findOne({ _id: quizId, ...req.tenantFilter });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });

    const { score, passed, incorrectQuestionIndexes } = gradeSubmission(quiz, answers);

    const submission = await QuizSubmission.create({
      tenantId: req.user.tenantId,
      quizId: quiz._id,
      studentId: req.user._id,
      answers,
      score,
      passed,
      incorrectQuestionIndexes
    });

    await createNotificationsForAudience({
      tenantId: req.user.tenantId,
      instructorId: quiz.instructorId,
      type: 'exam_result',
      title: 'نتيجة الاختبار',
      body: `درجتك: ${score}%`,
      relatedId: submission._id,
      recipientIds: req.user._id
    });

    // Lecture-progression gating (feature #6): only applies when the quiz is
    // tied to a course. The actual "is the NEXT lecture unlocked" read
    // happens in courseController.getCourse (updated below) by checking this
    // same LectureProgress record for the PRECEDING course — nothing about
    // unlocking is computed or stored here.
    if (quiz.courseId && passed) {
      await LectureProgress.findOneAndUpdate(
        { studentId: req.user._id, courseId: quiz.courseId, ...req.tenantFilter },
        { $set: { quizPassed: true }, $setOnInsert: { tenantId: req.user.tenantId } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Post-submission it's safe to reveal the answer key + explanations —
    // this response feeds QuizResultsPage's per-question review list.
    res.json({
      data: {
        submissionId: submission._id,
        score,
        passed,
        passingScore: quiz.passingScore,
        questions: quiz.questions.map((q, idx) => ({
          _id: q._id,
          text: q.text,
          options: q.options,
          correctOptionIndex: q.correctOptionIndex,
          explanation: q.explanation,
          studentAnswerIndex: answers[idx] ?? null
        }))
      }
    });
  } catch (err) {
    next(err);
  }
};

function canViewSubmission(user, submission, instructorIdOfQuiz) {
  if (String(submission.studentId) === String(user._id)) return true;
  if (user.role === 'admin' && String(user._id) === String(instructorIdOfQuiz)) return true;
  if (user.role === 'assistant' && String(user.instructorId) === String(instructorIdOfQuiz)) return true;
  return false;
}

// GET /api/v1/quizzes/submissions/:submissionId
// protect. Ownership: the student who took it, OR an admin/assistant
// belonging to the instructor that owns the underlying course/quiz.
exports.getSubmission = async (req, res, next) => {
  try {
    const submission = await QuizSubmission.findOne({ _id: req.params.submissionId, ...req.tenantFilter });
    if (!submission) return res.status(404).json({ message: 'المحاولة غير موجودة' });

    const quiz = await Quiz.findOne({ _id: submission.quizId, ...req.tenantFilter });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });

    let instructorIdOfQuiz = quiz.instructorId;
    if (!instructorIdOfQuiz && quiz.courseId) {
      const course = await Course.findOne({ _id: quiz.courseId, ...req.tenantFilter });
      instructorIdOfQuiz = course ? course.instructorId : null;
    }

    if (!canViewSubmission(req.user, submission, instructorIdOfQuiz)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض هذه المحاولة' });
    }

    // Join quiz questions + explanations into the response — this is a
    // review of a PAST completed attempt, so revealing the answer key here
    // is safe (unlike getQuiz's pre-submission stripping).
    res.json({ data: { submission, questions: quiz.questions } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/quizzes/submissions/:submissionId/retry
// protect + authorize('student') + ownership check. Returns only the
// incorrect questions from the original attempt, WITHOUT answer keys.
exports.getRetryQuiz = async (req, res, next) => {
  try {
    const original = await QuizSubmission.findOne({ _id: req.params.submissionId, ...req.tenantFilter });
    if (!original) return res.status(404).json({ message: 'المحاولة غير موجودة' });

    if (String(original.studentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بإعادة محاولة هذا الاختبار' });
    }

    const quiz = await Quiz.findOne({ _id: original.quizId, ...req.tenantFilter });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });

    // originalIndex is carried along so submitRetry can map submitted
    // answers back to the correct question in the full quiz.questions array.
    const retryQuestions = original.incorrectQuestionIndexes.map((idx) => {
      const q = quiz.questions[idx];
      return {
        originalIndex: idx,
        _id: q._id,
        text: q.text,
        options: q.options
      };
    });

    res.json({ data: { submissionId: original._id, questions: retryQuestions } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/quizzes/submissions/:submissionId/retry/submit
// protect + authorize('student') + ownership check. Body: { answers } —
// answers correspond 1:1 with the retry payload's order (originalIndex).
exports.submitRetry = async (req, res, next) => {
  try {
    const { answers } = req.body;
    const original = await QuizSubmission.findOne({ _id: req.params.submissionId, ...req.tenantFilter });
    if (!original) return res.status(404).json({ message: 'المحاولة غير موجودة' });

    if (String(original.studentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بإعادة محاولة هذا الاختبار' });
    }

    if (!Array.isArray(answers) || answers.length !== original.incorrectQuestionIndexes.length) {
      return res.status(400).json({ message: 'إجابات غير صالحة' });
    }

    const quiz = await Quiz.findOne({ _id: original.quizId, ...req.tenantFilter });
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });

    const stillIncorrectOriginalIndexes = [];
    const reviewQuestions = [];

    original.incorrectQuestionIndexes.forEach((originalIdx, i) => {
      const q = quiz.questions[originalIdx];
      const isCorrect = answers[i] === q.correctOptionIndex;
      if (!isCorrect) stillIncorrectOriginalIndexes.push(originalIdx);
      reviewQuestions.push({
        _id: q._id,
        text: q.text,
        options: q.options,
        correctOptionIndex: q.correctOptionIndex,
        explanation: q.explanation,
        studentAnswerIndex: answers[i]
      });
    });

    const totalRetried = original.incorrectQuestionIndexes.length;
    const correctOnRetry = totalRetried - stillIncorrectOriginalIndexes.length;
    const retryScore = totalRetried > 0 ? Math.round((correctOnRetry / totalRetried) * 100) : 100;
    const fullyCorrectOnRetry = stillIncorrectOriginalIndexes.length === 0;

    const retrySubmission = await QuizSubmission.create({
      tenantId: req.user.tenantId,
      quizId: quiz._id,
      studentId: req.user._id,
      answers,
      score: retryScore,
      passed: fullyCorrectOnRetry,
      incorrectQuestionIndexes: stillIncorrectOriginalIndexes,
      isRetryAttempt: true,
      retryOfSubmissionId: original._id
    });

    if (fullyCorrectOnRetry) {
      // Feature #6: a student who fixes every mistake on retry counts as
      // having passed the lecture retroactively — flip the ORIGINAL
      // submission's passed flag, since that's the record any future gating
      // check reads, and re-run the same lecture-progress unlock update.
      original.passed = true;
      await original.save();

      if (quiz.courseId) {
        await LectureProgress.findOneAndUpdate(
          { studentId: req.user._id, courseId: quiz.courseId, ...req.tenantFilter },
          { $set: { quizPassed: true }, $setOnInsert: { tenantId: req.user.tenantId } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }

      return res.json({
        data: { retrySubmissionId: retrySubmission._id, passed: true, showExplanations: false }
      });
    }

    // Feature #7 fallback UX: still wrong after retry — show correct
    // answers + explanations for every still-wrong question instead of
    // offering a third attempt.
    res.json({
      data: {
        retrySubmissionId: retrySubmission._id,
        passed: false,
        showExplanations: true,
        questions: reviewQuestions
      }
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/quizzes/:id/eligibility
exports.checkMonthlyExamEligibility = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'معرف الاختبار غير صالح' });
    const quiz = await Quiz.findOne({ _id: id, ...req.tenantFilter }).select('type prerequisiteQuizIds instructorId stage month');
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });
    if (quiz.type !== 'monthly_exam') return res.status(400).json({ message: 'فحص الأهلية متاح لاختبارات الشهر فقط' });
    res.json({ data: await getMonthlyExamEligibility(quiz, req.user, req.tenantFilter) });
  } catch (err) {
    next(err);
  }
};
