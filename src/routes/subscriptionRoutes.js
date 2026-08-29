const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  getCurrentSubscription,
  createSubscription,
  submitMonthlyExam,
  checkoutSubscription
} = require('../controllers/subscriptionController');

router.get('/:studentId/current', protect, tenantScope, getCurrentSubscription);
router.post('/', protect, tenantScope, authorize('student'), createSubscription);
router.post('/monthly-exam/:subscriptionId/submit', protect, tenantScope, authorize('student'), submitMonthlyExam);
router.post('/:stageId/checkout', protect, tenantScope, authorize('student'), checkoutSubscription);

module.exports = router;
