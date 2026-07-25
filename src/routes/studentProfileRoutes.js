const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { getStudentProfile } = require('../controllers/studentProfileController');

router.get('/:instructorId/students/:studentId/profile', protect, authorize('admin', 'assistant'), getStudentProfile);

module.exports = router;