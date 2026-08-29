const crypto = require('crypto');
const axios = require('axios');
const Course = require('../models/Course');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const LectureAccess = require('../models/LectureAccess');
const Subscription = require('../models/Subscription');

const PAYMOB_BASE_URL = 'https://accept.paymob.com/api';

// POST /api/v1/courses/:courseId/checkout/paymob
// protect + authorize('student').
exports.startCourseCheckout = async (req, res, next) => {
  try {
    const { courseId } = req.params;

    const course = await Course.findOne({ _id: courseId, ...req.tenantFilter });
    if (!course) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

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
      amount: course.price,
      relatedCourseId: course._id,
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
      amount_cents: Math.round(course.price * 100),
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
      amount_cents: Math.round(course.price * 100),
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

    if (transaction.type === 'purchase' && transaction.relatedCourseId) {
      const course = await Course.findOne({ _id: transaction.relatedCourseId, tenantId: transaction.tenantId });
      if (course) {
        const purchasedAt = new Date();
        const expiresAt = new Date(purchasedAt);
        expiresAt.setDate(expiresAt.getDate() + course.accessPeriodDays);

        // Same LectureAccess creation as the access-code redemption path —
        // this closes the B5 dependency via the Paymob path too.
        await LectureAccess.findOneAndUpdate(
          { studentId: transaction.userId, courseId: course._id, tenantId: transaction.tenantId },
          {
            $setOnInsert: {
              tenantId: transaction.tenantId,
              purchasedAt,
              expiresAt,
              maxViews: course.maxViews,
              viewsUsed: 0
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
    } else if (transaction.type === 'topup') {
      await User.updateOne({ _id: transaction.userId, tenantId: transaction.tenantId }, { $inc: { walletBalance: transaction.amount } });
    }

    res.json({ message: 'ok' });
  } catch (err) {
    next(err);
  }
};
