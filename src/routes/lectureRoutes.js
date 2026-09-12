const express = require('express');
const router = express.Router();
const { protect, optionalProtect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadGeneral } = require('../middlewares/uploadMiddleware');
const { createLecture, listCourseLectures, listFeaturedLectures, listLecturesForEditing, updateLecture, reorderLectures, deleteLecture, initLectureVideoUpload, confirmLectureVideoUpload } = require('../controllers/lectureController');
const uploads = uploadGeneral.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'homework', maxCount: 1 }]);
const gateVideoUpload = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_upload_video')(req, res, next);
};

// Published lecture previews are public. The controller derives the tenant
// from the published course, so this route intentionally does not use tenantScope.
router.get('/courses/:courseId/lectures', optionalProtect, listCourseLectures);
router.get('/instructors/:instructorId/lectures/featured', optionalProtect, listFeaturedLectures);
router.post('/instructors/:instructorId/courses/:courseId/lectures', protect, tenantScope, authorize('admin', 'assistant'), uploads, createLecture);
router.post('/instructors/:instructorId/courses/:courseId/lectures/:lectureId/video-upload-init', protect, tenantScope, authorize('admin', 'assistant'), gateVideoUpload, initLectureVideoUpload);
router.post('/instructors/:instructorId/courses/:courseId/lectures/:lectureId/confirm-video-upload', protect, tenantScope, authorize('admin', 'assistant'), gateVideoUpload, confirmLectureVideoUpload);
router.get('/instructors/:instructorId/courses/:courseId/lectures', protect, tenantScope, authorize('admin', 'assistant'), listLecturesForEditing);
router.patch('/instructors/:instructorId/courses/:courseId/lectures/reorder', protect, tenantScope, authorize('admin', 'assistant'), reorderLectures);
router.patch('/instructors/:instructorId/courses/:courseId/lectures/:lectureId', protect, tenantScope, authorize('admin', 'assistant'), uploads, updateLecture);
router.delete('/instructors/:instructorId/courses/:courseId/lectures/:lectureId', protect, tenantScope, authorize('admin', 'assistant'), deleteLecture);
module.exports = router;
