const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadAssignment } = require('../middlewares/uploadMiddleware');
const {
  submitAssignment,
  getMyAssignment,
  getPendingAssignments,
  getInstructorAssignments,
  getAssignment,
  gradeAssignment
} = require('../controllers/assignmentController');

const gradeGate = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_grade_exams')(req, res, next);
};

router.post('/courses/:courseId/assignments/submit', protect, tenantScope, authorize('student'), uploadAssignment, submitAssignment);
router.get('/courses/:courseId/assignments/mine', protect, tenantScope, authorize('student'), getMyAssignment);
router.get('/instructors/:instructorId/assignments/pending', protect, tenantScope, authorize('admin', 'assistant'), gradeGate, getPendingAssignments);
router.get('/instructors/:instructorId/assignments', protect, tenantScope, authorize('admin', 'assistant'), gradeGate, getInstructorAssignments);
router.get('/assignments/:id', protect, tenantScope, getAssignment);
router.patch('/assignments/:id/grade', protect, tenantScope, authorize('admin', 'assistant'), gradeGate, gradeAssignment);

module.exports = router;
