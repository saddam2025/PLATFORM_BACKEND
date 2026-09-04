const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { getDashboardSummary } = require('../controllers/dashboardController');

const router = express.Router();
router.get('/:instructorId/dashboard/summary', protect, tenantScope, authorize('admin'), getDashboardSummary);
module.exports = router;
