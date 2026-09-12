const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadGeneral } = require('../middlewares/uploadMiddleware');
const {
  createCourse,
  listCourses,
  getCourse,
  updateCourse,
  deleteCourse,
  listCategories
} = require('../controllers/courseController');

// Conditional permission check: admins bypass entirely, assistants must have
// can_upload_video. This mirrors the requirePermission() middleware's own
// internal admin-bypass logic, applied explicitly here so the route reads
// clearly rather than relying solely on the middleware's implicit behavior.
const gateVideoUpload = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_upload_video')(req, res, next);
};

const uploadFields = uploadGeneral.fields([{ name: 'thumbnail', maxCount: 1 }]);

router.post(
  '/:instructorId/courses',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  uploadFields,
  gateVideoUpload,
  createCourse
);

router.get('/:instructorId/courses', listCourses); // public, optional-auth handled inside
router.get('/:instructorId/courses/:courseId', getCourse); // public, optional-auth handled inside

router.patch(
  '/:instructorId/courses/:courseId',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  uploadFields,
  updateCourse
);

// Admin only — see deleteCourse's inline comment for the reasoning.
router.delete('/:instructorId/courses/:courseId', protect, tenantScope, authorize('admin'), deleteCourse);

router.get('/:instructorId/categories', listCategories);

module.exports = router;
