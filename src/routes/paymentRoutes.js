const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { startCourseCheckout, checkoutFreeCourse, checkoutCourseWithWallet, handlePaymobWebhook } = require('../controllers/paymentController');

router.post('/courses/:courseId/checkout/paymob', protect, tenantScope, authorize('student'), startCourseCheckout);
router.post('/courses/:courseId/checkout/free', protect, tenantScope, authorize('student'), checkoutFreeCourse);
router.post('/courses/:courseId/checkout/wallet', protect, tenantScope, authorize('student'), checkoutCourseWithWallet);

// PUBLIC — Paymob calls this directly, no protect() middleware. The HMAC
// check inside handlePaymobWebhook is the ONLY authentication boundary this
// route has, and it is mandatory — see the CRITICAL comment in the
// controller.
router.post('/webhooks/paymob', handlePaymobWebhook);

module.exports = router;
