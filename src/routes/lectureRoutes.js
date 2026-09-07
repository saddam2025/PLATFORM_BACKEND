const express = require('express');
const router = express.Router();
const { protect, optionalProtect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadVideo } = require('../middlewares/uploadMiddleware');
const { createLecture, listCourseLectures, listLecturesForEditing, updateLecture, reorderLectures, deleteLecture } = require('../controllers/lectureController');
const uploads = uploadVideo.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }, { name: 'homework', maxCount: 1 }]);

// Published lecture previews are public. The controller derives the tenant
// from the published course, so this route intentionally does not use tenantScope.
router.get('/courses/:courseId/lectures', optionalProtect, listCourseLectures);
router.post('/instructors/:instructorId/courses/:courseId/lectures', protect, tenantScope, authorize('admin', 'assistant'), uploads, createLecture);
router.get('/instructors/:instructorId/courses/:courseId/lectures', protect, tenantScope, authorize('admin', 'assistant'), listLecturesForEditing);
router.patch('/instructors/:instructorId/courses/:courseId/lectures/reorder', protect, tenantScope, authorize('admin', 'assistant'), reorderLectures);
router.patch('/instructors/:instructorId/courses/:courseId/lectures/:lectureId', protect, tenantScope, authorize('admin', 'assistant'), uploads, updateLecture);
router.delete('/instructors/:instructorId/courses/:courseId/lectures/:lectureId', protect, tenantScope, authorize('admin', 'assistant'), deleteLecture);
module.exports = router;
