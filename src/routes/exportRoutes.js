const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { exportStudents } = require('../controllers/exportController');

router.get('/:instructorId/students/export', protect, tenantScope, authorize('admin'), exportStudents);

module.exports = router;
