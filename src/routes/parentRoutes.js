const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  getMyChild,
  getMyChildCourses,
  getMyChildExamGrades,
  getMyChildAssignmentGrades,
  getMyChildReport,
  getMyChildActivity
} = require('../controllers/parentController');

const router = express.Router();

// Parent identity comes exclusively from the JWT. There is intentionally no
// child ID route parameter: a parent cannot select or enumerate another child.
router.get('/me/child', protect, tenantScope, authorize('parent'), getMyChild);
router.get('/me/child/courses', protect, tenantScope, authorize('parent'), getMyChildCourses);
router.get('/me/child/exam-grades', protect, tenantScope, authorize('parent'), getMyChildExamGrades);
router.get('/me/child/assignment-grades', protect, tenantScope, authorize('parent'), getMyChildAssignmentGrades);
router.get('/me/child/report', protect, tenantScope, authorize('parent'), getMyChildReport);
router.get('/me/child/activity', protect, tenantScope, authorize('parent'), getMyChildActivity);

module.exports = router;
