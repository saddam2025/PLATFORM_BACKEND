const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { startCourseCheckout, startLectureCheckout, checkoutFreeCourse, checkoutCourseWithWallet, checkoutLectureFree, checkoutLectureWithWallet, handlePaymobWebhook } = require('../controllers/paymentController');

router.post('/courses/:courseId/checkout/paymob', protect, tenantScope, authorize('student'), startCourseCheckout);
router.post('/courses/:courseId/checkout/free', protect, tenantScope, authorize('student'), checkoutFreeCourse);
router.post('/courses/:courseId/checkout/wallet', protect, tenantScope, authorize('student'), checkoutCourseWithWallet);
router.post('/courses/:courseId/lectures/:lectureId/checkout/free', protect, tenantScope, authorize('student'), checkoutLectureFree);
router.post('/courses/:courseId/lectures/:lectureId/checkout/wallet', protect, tenantScope, authorize('student'), checkoutLectureWithWallet);
router.post('/courses/:courseId/lectures/:lectureId/checkout/paymob', protect, tenantScope, authorize('student'), startLectureCheckout);

// PUBLIC — Paymob calls this directly, no protect() middleware. The HMAC
// check inside handlePaymobWebhook is the ONLY authentication boundary this
// route has, and it is mandatory — see the CRITICAL comment in the
// controller.
router.post('/webhooks/paymob', handlePaymobWebhook);

module.exports = router;
