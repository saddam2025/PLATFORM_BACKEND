const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  getQuiz,
  checkMonthlyExamEligibility,
  submitQuiz,
  getSubmission,
  getRetryQuiz,
  submitRetry,
  getCourseQuizForEditing,
  createCourseQuiz,
  updateCourseQuiz,
  deleteCourseQuiz
} = require('../controllers/quizController');

const authoringRouter = express.Router();
const quizAuthoringGate = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_grade_exams')(req, res, next);
};

authoringRouter.get('/:instructorId/courses/:courseId/quiz', protect, tenantScope, authorize('admin', 'assistant'), quizAuthoringGate, getCourseQuizForEditing);
authoringRouter.post('/:instructorId/courses/:courseId/quiz', protect, tenantScope, authorize('admin', 'assistant'), quizAuthoringGate, createCourseQuiz);

router.get('/:id/eligibility', protect, tenantScope, authorize('student'), checkMonthlyExamEligibility);
router.get('/submissions/:submissionId', protect, tenantScope, getSubmission); // ownership checked inside
router.post('/submissions/:submissionId/retry', protect, tenantScope, authorize('student'), getRetryQuiz);
router.post('/submissions/:submissionId/retry/submit', protect, tenantScope, authorize('student'), submitRetry);
router.patch('/:id', protect, tenantScope, authorize('admin', 'assistant'), quizAuthoringGate, updateCourseQuiz);
router.delete('/:id', protect, tenantScope, authorize('admin', 'assistant'), quizAuthoringGate, deleteCourseQuiz);
router.get('/:quizId', protect, tenantScope, getQuiz);
router.post('/:quizId/submit', protect, tenantScope, authorize('student'), submitQuiz);

module.exports = { quizRoutes: router, quizAuthoringRoutes: authoringRouter };
