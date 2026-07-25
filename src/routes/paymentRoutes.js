const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { startCourseCheckout, handlePaymobWebhook } = require('../controllers/paymentController');

router.post('/courses/:courseId/checkout/paymob', protect, authorize('student'), startCourseCheckout);

// PUBLIC — Paymob calls this directly, no protect() middleware. The HMAC
// check inside handlePaymobWebhook is the ONLY authentication boundary this
// route has, and it is mandatory — see the CRITICAL comment in the
// controller.
router.post('/webhooks/paymob', handlePaymobWebhook);

module.exports = router;