const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { listInstructorStudents, getStudentDirectoryDetail, getStudentProfile, resetStudentPassword } = require('../controllers/studentProfileController');
const rateLimit = require('express-rate-limit');

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'محاولات تغيير كلمة المرور كثيرة. حاول لاحقًا.' }
});

router.get('/:instructorId/students', protect, tenantScope, authorize('admin', 'assistant'), listInstructorStudents);
router.get('/:instructorId/students/:studentId', protect, tenantScope, authorize('admin', 'assistant'), getStudentDirectoryDetail);
router.get('/:instructorId/students/:studentId/profile', protect, tenantScope, authorize('admin', 'assistant'), getStudentProfile);
router.patch('/:instructorId/students/:studentId/reset-password', protect, tenantScope, authorize('admin', 'assistant'), passwordResetLimiter, resetStudentPassword);

module.exports = router;
