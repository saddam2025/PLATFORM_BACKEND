const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getQuiz,
  submitQuiz,
  getSubmission,
  getRetryQuiz,
  submitRetry
} = require('../controllers/quizController');

router.get('/:quizId', protect, getQuiz);
router.post('/:quizId/submit', protect, authorize('student'), submitQuiz);
router.get('/submissions/:submissionId', protect, getSubmission); // ownership checked inside
router.post('/submissions/:submissionId/retry', protect, authorize('student'), getRetryQuiz);
router.post('/submissions/:submissionId/retry/submit', protect, authorize('student'), submitRetry);

module.exports = router;