const Quiz = require('../models/Quiz');
const QuizSubmission = require('../models/QuizSubmission');
const LectureProgress = require('../models/LectureProgress');
const Course = require('../models/Course');
const gradeSubmission = require('../utils/gradeQuiz');

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

// GET /api/v1/quizzes/:quizId
exports.getQuiz = async (req, res, next) => {
  try {
    const quiz = await Quiz.findById(req.params.quizId);
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });
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
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });

    const { score, passed, incorrectQuestionIndexes } = gradeSubmission(quiz, answers);

    const submission = await QuizSubmission.create({
      quizId: quiz._id,
      studentId: req.user._id,
      answers,
      score,
      passed,
      incorrectQuestionIndexes
    });

    // Lecture-progression gating (feature #6): only applies when the quiz is
    // tied to a course. The actual "is the NEXT lecture unlocked" read
    // happens in courseController.getCourse (updated below) by checking this
    // same LectureProgress record for the PRECEDING course — nothing about
    // unlocking is computed or stored here.
    if (quiz.courseId && passed) {
      await LectureProgress.findOneAndUpdate(
        { studentId: req.user._id, courseId: quiz.courseId },
        { $set: { quizPassed: true } },
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
    const submission = await QuizSubmission.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ message: 'المحاولة غير موجودة' });

    const quiz = await Quiz.findById(submission.quizId);
    if (!quiz) return res.status(404).json({ message: 'الاختبار غير موجود' });

    let instructorIdOfQuiz = quiz.instructorId;
    if (!instructorIdOfQuiz && quiz.courseId) {
      const course = await Course.findById(quiz.courseId);
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
    const original = await QuizSubmission.findById(req.params.submissionId);
    if (!original) return res.status(404).json({ message: 'المحاولة غير موجودة' });

    if (String(original.studentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بإعادة محاولة هذا الاختبار' });
    }

    const quiz = await Quiz.findById(original.quizId);
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
    const original = await QuizSubmission.findById(req.params.submissionId);
    if (!original) return res.status(404).json({ message: 'المحاولة غير موجودة' });

    if (String(original.studentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بإعادة محاولة هذا الاختبار' });
    }

    if (!Array.isArray(answers) || answers.length !== original.incorrectQuestionIndexes.length) {
      return res.status(400).json({ message: 'إجابات غير صالحة' });
    }

    const quiz = await Quiz.findById(original.quizId);
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
          { studentId: req.user._id, courseId: quiz.courseId },
          { $set: { quizPassed: true } },
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