const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  startView,
  updateWatchProgress,
  getWatchProgress
} = require('../controllers/lectureAccessController');

router.post('/:courseId/start-view', protect, tenantScope, authorize('student'), startView);
router.patch('/:courseId/watch-progress', protect, tenantScope, authorize('student'), updateWatchProgress);
router.get('/:courseId/watch-progress', protect, tenantScope, authorize('student'), getWatchProgress);

module.exports = router;
