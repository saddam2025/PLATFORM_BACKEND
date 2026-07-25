const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  getCurrentSubscription,
  createSubscription,
  submitMonthlyExam,
  checkoutSubscription
} = require('../controllers/subscriptionController');

router.get('/:studentId/current', protect, getCurrentSubscription);
router.post('/', protect, authorize('student'), createSubscription);
router.post('/monthly-exam/:subscriptionId/submit', protect, authorize('student'), submitMonthlyExam);
router.post('/:stageId/checkout', protect, authorize('student'), checkoutSubscription);

module.exports = router;