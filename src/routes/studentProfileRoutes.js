const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { getStudentProfile } = require('../controllers/studentProfileController');

router.get('/:instructorId/students/:studentId/profile', protect, tenantScope, authorize('admin', 'assistant'), getStudentProfile);

module.exports = router;
