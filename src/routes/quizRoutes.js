const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  getQuiz,
  checkMonthlyExamEligibility,
  submitQuiz,
  getSubmission,
  getRetryQuiz,
  submitRetry
} = require('../controllers/quizController');

router.get('/:id/eligibility', protect, tenantScope, authorize('student'), checkMonthlyExamEligibility);
router.get('/:quizId', protect, tenantScope, getQuiz);
router.post('/:quizId/submit', protect, tenantScope, authorize('student'), submitQuiz);
router.get('/submissions/:submissionId', protect, tenantScope, getSubmission); // ownership checked inside
router.post('/submissions/:submissionId/retry', protect, tenantScope, authorize('student'), getRetryQuiz);
router.post('/submissions/:submissionId/retry/submit', protect, tenantScope, authorize('student'), submitRetry);

module.exports = router;
