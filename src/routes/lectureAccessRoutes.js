const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  startLectureView,
  updateLectureWatchProgress,
  getLectureWatchProgress,
  streamLectureVideo,
  listEnrolledCourses
} = require('../controllers/lectureAccessController');

router.get('/enrolled', protect, tenantScope, authorize('student'), listEnrolledCourses);
router.post('/:courseId/lectures/:lectureId/start-view', protect, tenantScope, authorize('student'), startLectureView);
router.patch('/:courseId/lectures/:lectureId/watch-progress', protect, tenantScope, authorize('student'), updateLectureWatchProgress);
router.get('/:courseId/lectures/:lectureId/watch-progress', protect, tenantScope, authorize('student'), getLectureWatchProgress);
router.get('/:courseId/lectures/:lectureId/video', streamLectureVideo);

module.exports = router;
