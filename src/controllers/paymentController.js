const crypto = require('crypto');
const axios = require('axios');
const Course = require('../models/Course');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const LectureAccess = require('../models/LectureAccess');
const Lecture = require('../models/Lecture');
const LectureProgress = require('../models/LectureProgress');
const { grantCourseEnrollment, grantLectureAccess } = require('../utils/grantLearningAccess');
const Subscription = require('../models/Subscription');

const PAYMOB_BASE_URL = 'https://accept.paymob.com/api';

async function grantCourseAccess({ course, studentId, tenantId, source }) {
  return grantCourseEnrollment({ course, studentId, tenantId, source });
}

async function findLectureForCheckout(req) {
  const lecture = await Lecture.findOne({ _id: req.params.lectureId, courseId: req.params.courseId, ...req.tenantFilter });
  if (!lecture || !lecture.isPublished) { const error = new Error('المحاضرة غير متاحة'); error.statusCode = 404; throw error; }
  return lecture;
}

async function assertNoIncompletePaidLecture(req) {
  const accesses = await LectureAccess.find({ studentId: req.user._id, ...req.tenantFilter, expiresAt: { $gt: new Date() } }).lean();
  const lectureIds = accesses.map((row) => row.courseId);
  if (!lectureIds.length) return;
  const lectures = await Lecture.find({ _id: { $in: lectureIds }, price: { $gt: 0 }, ...req.tenantFilter }).select('_id videoUrl homeworkUrl quizId').lean();
  if (!lectures.length) return;
  const progress = await LectureProgress.find({ studentId: req.user._id, lectureId: { $in: lectures.map((lecture) => lecture._id) }, ...req.tenantFilter }).lean();
  const incomplete = lectures.find((lecture) => {
    const row = progress.find((item) => String(item.lectureId) === String(lecture._id));
    return (lecture.videoUrl && !row?.videoCompleted) || (lecture.homeworkUrl && !row?.homeworkCompleted) || (lecture.quizId && !row?.quizPassed);
  });
  if (incomplete) throw Object.assign(new Error('أكمل متطلبات المحاضرة التي اشتريتها أولاً قبل شراء محاضرة مدفوعة أخرى'), { statusCode: 403 });
}

exports.checkoutLectureFree = async (req, res, next) => {
  try { const lecture = await findLectureForCheckout(req); if (Number(lecture.price) !== 0) return res.status(400).json({ message: 'هذه المحاضرة ليست مجانية' }); const access = await grantLectureAccess({ lecture, studentId: req.user._id, tenantId: req.user.tenantId }); res.status(201).json({ data: { access, lectureId: lecture._id } }); } catch (err) { next(err); }
};

exports.checkoutLectureWithWallet = async (req, res, next) => {
  try {
    const lecture = await findLectureForCheckout(req);
    if (Number(lecture.price) === 0) return res.status(400).json({ message: 'هذه المحاضرة مجانية' });
    await assertNoIncompletePaidLecture(req);
    const student = await User.findOne({ _id: req.user._id, ...req.tenantFilter });
    if (!student || Number(student.walletBalance || 0) < Number(lecture.price)) return res.status(400).json({ message: 'رصيد المحفظة غير كافٍ' });
    const access = await grantLectureAccess({ lecture, studentId: req.user._id, tenantId: req.user.tenantId });
    student.walletBalance -= Number(lecture.price); await student.save();
    await Transaction.create({ tenantId: req.user.tenantId, userId: req.user._id, type: 'purchase', source: 'wallet', amount: lecture.price, relatedCourseId: lecture.courseId, relatedLectureId: lecture._id, status: 'success' });
    res.status(201).json({ data: { access, lectureId: lecture._id, walletBalance: student.walletBalance } });
  } catch (err) { next(err); }
};

async function findCourseForCheckout(req) {
  const course = await Course.findOne({ _id: req.params.courseId, isPublished: true, ...req.tenantFilter });
  if (!course) {
    const error = new Error('المحاضرة غير موجودة');
    error.statusCode = 404;
    throw error;
  }
  return course;
}

// A free enrollment still creates a success transaction. This keeps revenue
// reports and enrollment auditing consistent while accurately recording that
// no payment provider or wallet balance was involved.
exports.checkoutFreeCourse = async (req, res, next) => {
  try {
    const course = await findCourseForCheckout(req);
    if (Number(course.price) !== 0) return res.status(400).json({ message: 'هذه الدورة ليست مجانية' });

    const access = await grantCourseAccess({ course, studentId: req.user._id, tenantId: req.user.tenantId, source: 'free' });
    await Transaction.findOneAndUpdate(
      { tenantId: req.user.tenantId, userId: req.user._id, relatedCourseId: course._id, source: 'free' },
      { $setOnInsert: { type: 'purchase', amount: 0, status: 'success' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ data: { access, courseId: course._id } });
  } catch (err) {
    next(err);
  }
};

// Scratch cards credit the wallet first; this endpoint spends that wallet
// balance and never receives a scratch-card code directly.
exports.checkoutCourseWithWallet = async (req, res, next) => {
  try {
    const course = await findCourseForCheckout(req);
    if (Number(course.price) <= 0) return res.status(400).json({ message: 'استخدم الاشتراك المجاني لهذه الدورة' });
    const student = await User.findOne({ _id: req.user._id, ...req.tenantFilter });
    if (!student || Number(student.walletBalance || 0) < Number(course.price)) {
      return res.status(400).json({ message: 'رصيد المحفظة غير كافٍ' });
    }

    const existing = await LectureAccess.findOne({ studentId: req.user._id, courseId: course._id, tenantId: req.user.tenantId });
    if (existing) return res.status(400).json({ message: 'أنت مشترك بالفعل في هذه الدورة' });

    student.walletBalance -= Number(course.price);
    await student.save();
    const access = await grantCourseAccess({ course, studentId: req.user._id, tenantId: req.user.tenantId, source: 'wallet' });
    await Transaction.create({
      tenantId: req.user.tenantId,
      userId: req.user._id,
      type: 'purchase',
      source: 'wallet',
      amount: course.price,
      relatedCourseId: course._id,
      status: 'success'
    });
    res.status(201).json({ data: { access, walletBalance: student.walletBalance } });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/courses/:courseId/checkout/paymob
// protect + authorize('student').
async function startPaymobCheckout(req, res, next, item) {
  try {
    const course = item.course;
    const lecture = item.lecture || null;

    // paymobApiKey/paymobWebhookSecret are select:false by default (see B7
    // User.js edit) — explicit .select() needed here since this is exactly
    // the legitimate server-to-server use case those fields exist for.
    // This request NEVER forwards these values to the client; only the
    // resulting iframe URL/payment token is returned below.
    const instructor = await User.findOne({ _id: course.instructorId, ...req.tenantFilter }).select('+paymobApiKey +paymobIntegrationId');
    if (!instructor || !instructor.paymobApiKey || !instructor.paymobIntegrationId) {
      return res.status(400).json({ message: 'بوابة الدفع غير مهيأة لهذا المدرس' });
    }

    // Create a pending Transaction up front so the webhook has a record to
    // update once Paymob calls back.
    const transaction = await Transaction.create({
      tenantId: req.user.tenantId,
      userId: req.user._id,
      type: 'purchase',
      source: 'paymob',
      amount: item.price,
      relatedCourseId: course._id,
      relatedLectureId: lecture?._id || null,
      status: 'pending'
    });

    // Step 1: auth token
    const authRes = await axios.post(`${PAYMOB_BASE_URL}/auth/tokens`, {
      api_key: instructor.paymobApiKey
    });
    const authToken = authRes.data.token;

    // Step 2: order registration
    const orderRes = await axios.post(`${PAYMOB_BASE_URL}/ecommerce/orders`, {
      auth_token: authToken,
      delivery_needed: false,
      amount_cents: Math.round(item.price * 100),
      currency: 'EGP',
      // merchant_order_id carries our own transaction id through Paymob's
      // system so the webhook can match it back to this Transaction.
      merchant_order_id: String(transaction._id),
      items: []
    });
    const orderId = orderRes.data.id;

    // Step 3: payment key
    const paymentKeyRes = await axios.post(`${PAYMOB_BASE_URL}/acceptance/payment_keys`, {
      auth_token: authToken,
      amount_cents: Math.round(item.price * 100),
      expiration: 3600,
      order_id: orderId,
      billing_data: {
        first_name: req.user.name || 'Student',
        last_name: 'N/A',
        email: req.user.email,
        phone_number: req.user.phone || 'NA',
        apartment: 'NA',
        floor: 'NA',
        street: 'NA',
        building: 'NA',
        shipping_method: 'NA',
        postal_code: 'NA',
        city: 'NA',
        country: 'NA',
        state: 'NA'
      },
      currency: 'EGP',
      integration_id: instructor.paymobIntegrationId
    });
    const paymentToken = paymentKeyRes.data.token;

    const iframeUrl = `https://accept.paymob.com/api/acceptance/iframes/${instructor.paymobIntegrationId}?payment_token=${paymentToken}`;

    // Only the iframe URL/token goes to the client — never
    // instructor.paymobApiKey or any raw Paymob credential.
    res.json({ data: { iframeUrl, transactionId: transaction._id } });
  } catch (err) {
    next(err);
  }
}

exports.startCourseCheckout = async (req, res, next) => {
  try {
    const course = await findCourseForCheckout(req);
    if (Number(course.price) <= 0) return res.status(400).json({ message: 'هذه الدورة مجانية' });
    return startPaymobCheckout(req, res, next, { course, price: Number(course.price) });
  } catch (err) { return next(err); }
};

exports.startLectureCheckout = async (req, res, next) => {
  try {
    const lecture = await findLectureForCheckout(req);
    if (Number(lecture.price) <= 0) return res.status(400).json({ message: 'هذه المحاضرة مجانية' });
    await assertNoIncompletePaidLecture(req);
    const course = await findCourseForCheckout(req);
    return startPaymobCheckout(req, res, next, { course, lecture, price: Number(lecture.price) });
  } catch (err) { return next(err); }
};

// POST /api/v1/webhooks/paymob
// PUBLIC route — Paymob calls this directly, no JWT is attached.
// CRITICAL trust boundary: this endpoint MUST validate the HMAC signature
// using the instructor's paymobWebhookSecret BEFORE trusting ANY field in
// the payload. Without this check, anyone who discovers this URL could POST
// a fabricated "payment succeeded" body and grant themselves free course
// access or wallet credit — this is precisely the OWASP A08
// (Software/Data Integrity Failure) scenario: an unauthenticated webhook is
// a direct forgery vector.
exports.handlePaymobWebhook = async (req, res, next) => {
  try {
    const payload = req.body;
    const receivedHmac = req.query.hmac || payload.hmac;

    const merchantOrderId = payload?.obj?.order?.merchant_order_id;
    if (!merchantOrderId) {
      // eslint-disable-next-line no-console
      console.warn('[Paymob webhook] missing merchant_order_id in payload, rejecting');
      return res.status(400).json({ message: 'Invalid payload' });
    }

    if (!require('mongoose').isValidObjectId(merchantOrderId)) {
      return res.status(400).json({ message: 'Invalid payload' });
    }
    const transaction = await Transaction.findById(merchantOrderId);
    if (!transaction) {
      // eslint-disable-next-line no-console
      console.warn(`[Paymob webhook] no matching transaction for id ${merchantOrderId}, rejecting`);
      return res.status(400).json({ message: 'Invalid payload' });
    }

    // The transaction's amount tells us who the buyer is; from there we can
    // find the correct instructor to look up the correct webhook secret
    // (each instructor has their OWN Paymob integration and secret).
    let instructorId = null;
    if (transaction.relatedCourseId) {
      const course = await Course.findOne({ _id: transaction.relatedCourseId, tenantId: transaction.tenantId });
      instructorId = course ? course.instructorId : null;
    }

    if (!instructorId) {
      // eslint-disable-next-line no-console
      console.warn('[Paymob webhook] could not resolve instructor for HMAC verification, rejecting');
      return res.status(400).json({ message: 'Invalid payload' });
    }

    const instructor = await User.findOne({ _id: instructorId, tenantId: transaction.tenantId }).select('+paymobWebhookSecret');
    if (!instructor || !instructor.paymobWebhookSecret) {
      // eslint-disable-next-line no-console
      console.warn('[Paymob webhook] instructor has no webhook secret configured, rejecting');
      return res.status(400).json({ message: 'Invalid payload' });
    }

    // Paymob's HMAC is computed over a specific concatenation of fields in
    // a fixed order per their docs. Compute the same string here and
    // compare against the received hmac using a timing-safe comparison.
    const obj = payload.obj || {};
    const hmacFields = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order?.id,
      obj.owner,
      obj.pending,
      obj.source_data?.pan,
      obj.source_data?.sub_type,
      obj.source_data?.type,
      obj.success
    ]
      .map((v) => (v === undefined || v === null ? '' : String(v)))
      .join('');

    const computedHmac = crypto
      .createHmac('sha512', instructor.paymobWebhookSecret)
      .update(hmacFields)
      .digest('hex');

    const receivedBuf = Buffer.from(String(receivedHmac || ''), 'utf8');
    const computedBuf = Buffer.from(computedHmac, 'utf8');

    // Timing-safe comparison — a naive === comparison leaks timing
    // information that could theoretically help an attacker forge a valid
    // signature byte-by-byte.
    const isValidSignature =
      receivedBuf.length === computedBuf.length && crypto.timingSafeEqual(receivedBuf, computedBuf);

    if (!isValidSignature) {
      // eslint-disable-next-line no-console
      console.warn(`[Paymob webhook] INVALID HMAC signature for transaction ${transaction._id} — possible forgery attempt, rejecting`);
      return res.status(401).json({ message: 'Invalid signature' });
    }

    // Signature verified — now, and only now, is it safe to trust the
    // payload's success/failure status.
    const paymentSucceeded = obj.success === true || obj.success === 'true';

    if (!paymentSucceeded) {
      transaction.status = 'failed';
      transaction.paymobTxId = String(obj.id || '');
      await transaction.save();
      return res.json({ message: 'ok' });
    }

    transaction.status = 'success';
    transaction.paymobTxId = String(obj.id || '');
    await transaction.save();

    if (transaction.type === 'purchase' && transaction.relatedLectureId) {
      const lecture = await Lecture.findOne({ _id: transaction.relatedLectureId, courseId: transaction.relatedCourseId, tenantId: transaction.tenantId });
      if (lecture) await grantLectureAccess({ lecture, studentId: transaction.userId, tenantId: transaction.tenantId });
    } else if (transaction.type === 'purchase' && transaction.relatedCourseId) {
      const course = await Course.findOne({ _id: transaction.relatedCourseId, tenantId: transaction.tenantId });
      if (course) {
        await grantCourseEnrollment({ course, studentId: transaction.userId, tenantId: transaction.tenantId, source: 'paymob' });
      }
    } else if (transaction.type === 'topup') {
      await User.updateOne({ _id: transaction.userId, tenantId: transaction.tenantId }, { $inc: { walletBalance: transaction.amount } });
    }

    res.json({ message: 'ok' });
  } catch (err) {
    next(err);
  }
};
