const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { exportStudents } = require('../controllers/exportController');

router.get('/:instructorId/students/export', protect, authorize('admin'), exportStudents);

module.exports = router;