const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  startView,
  updateWatchProgress,
  getWatchProgress
} = require('../controllers/lectureAccessController');

router.post('/:courseId/start-view', protect, authorize('student'), startView);
router.patch('/:courseId/watch-progress', protect, authorize('student'), updateWatchProgress);
router.get('/:courseId/watch-progress', protect, authorize('student'), getWatchProgress);

module.exports = router;