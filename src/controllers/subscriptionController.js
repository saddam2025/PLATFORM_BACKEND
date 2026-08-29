const Subscription = require('../models/Subscription');
const Quiz = require('../models/Quiz');
const QuizSubmission = require('../models/QuizSubmission');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const gradeSubmission = require('../utils/gradeQuiz');

const MONTHLY_SUBSCRIPTION_PRICE = 199; // matches the mock price already shown in SubscriptionPlanPage.jsx

function currentMonthString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function previousMonthString(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return currentMonthString(d);
}

exports.getCurrentSubscription = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { stage } = req.query;

    const isSelf = String(req.user._id) === String(studentId);
    if (!isSelf && !['admin', 'assistant'].includes(req.user.role)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا الطالب' });
    }

    if (!stage) {
      return res.status(400).json({ message: 'المرحلة الدراسية مطلوبة' });
    }

    const month = currentMonthString();
    const subscription = await Subscription.findOne({ studentId, stage, month, ...req.tenantFilter });

    if (!subscription) {
      return res.status(404).json({ message: 'لا يوجد اشتراك حالي لهذا الشهر' });
    }

    if (!isSelf) {
      const ownsTenant =
        (req.user.role === 'admin' && String(req.user._id) === String(subscription.instructorId)) ||
        (req.user.role === 'assistant' && String(req.user.instructorId) === String(subscription.instructorId));
      if (!ownsTenant) {
        return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا الطالب' });
      }
    }

    res.json({ data: subscription });
  } catch (err) {
    next(err);
  }
};

// Kept for direct/manual subscription creation (e.g. admin comping a
// student) — the actual student-facing "subscribe now" button goes through
// checkoutSubscription below, which enforces payment before calling this
// same gate-then-create logic.
exports.createSubscription = async (req, res, next) => {
  try {
    const { instructorId, stage } = req.body;
    if (!instructorId || !stage) {
      return res.status(400).json({ message: 'المدرس والمرحلة مطلوبان' });
    }

    const instructor = await User.findOne({ _id: instructorId, role: 'admin', ...req.tenantFilter });
    if (!instructor) return res.status(404).json({ message: 'المدرس غير موجود' });

    const month = currentMonthString();
    const prevMonth = previousMonthString(month);

    const prevSubscription = await Subscription.findOne({
      studentId: req.user._id,
      instructorId,
      stage,
      month: prevMonth
      , ...req.tenantFilter
    });

    if (prevSubscription && !prevSubscription.monthlyExamPassed) {
      return res.status(403).json({ message: 'يجب اجتياز اختبار الشهر السابق أولاً' });
    }

    const existing = await Subscription.findOne({ studentId: req.user._id, instructorId, stage, month, ...req.tenantFilter });
    if (existing) {
      return res.status(400).json({ message: 'يوجد اشتراك بالفعل لهذا الشهر' });
    }

    const startedAt = new Date();
    const expiresAt = new Date(startedAt);
    expiresAt.setDate(expiresAt.getDate() + 30);

    const subscription = await Subscription.create({
      tenantId: req.user.tenantId,
      studentId: req.user._id,
      instructorId,
      stage,
      month,
      status: 'active',
      startedAt,
      expiresAt
    });

    res.status(201).json({ data: subscription });
  } catch (err) {
    next(err);
  }
};

exports.submitMonthlyExam = async (req, res, next) => {
  try {
    const { subscriptionId } = req.params;
    const { answers } = req.body;

    const subscription = await Subscription.findOne({ _id: subscriptionId, ...req.tenantFilter });
    if (!subscription) return res.status(404).json({ message: 'الاشتراك غير موجود' });

    if (String(subscription.studentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بهذا الإجراء' });
    }

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: 'إجابات غير صالحة' });
    }

    const quiz = await Quiz.findOne({
      type: 'monthly_exam',
      instructorId: subscription.instructorId,
      stage: subscription.stage,
      month: subscription.month,
      ...req.tenantFilter
      , ...req.tenantFilter
    });

    if (!quiz) {
      return res.status(404).json({ message: 'اختبار الشهر غير متاح بعد' });
    }

    const { score, passed, incorrectQuestionIndexes, totalMarks, earnedMarks, passingMarks } =
      gradeSubmission(quiz, answers);

    const submission = await QuizSubmission.create({
      tenantId: req.user.tenantId,
      quizId: quiz._id,
      studentId: req.user._id,
      answers,
      score,
      passed,
      incorrectQuestionIndexes
    });

    subscription.monthlyExamSubmissionId = submission._id;
    if (passed) {
      subscription.monthlyExamPassed = true;
      subscription.status = 'active';
    } else {
      subscription.status = 'pending_exam';
    }
    await subscription.save();

    res.json({
      data: { score, passed, totalMarks, earnedMarks, passingMarks, canSubscribeNextMonth: passed }
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/v1/subscriptions/:stageId/checkout
// protect + authorize('student'). Body: { instructorId, paymentMethod, code? }.
// This is the ACTUAL endpoint SubscriptionPlanPage.jsx's "اشترك الآن" button
// should call — it enforces payment (wallet-via-scratchcard-code, or
// Paymob) BEFORE creating the Subscription, reusing the exact same
// previous-month gate check as createSubscription so there is only one
// real enforcement path for feature #5, not two divergent ones.
exports.checkoutSubscription = async (req, res, next) => {
  try {
    const { stageId } = req.params;
    const { instructorId, paymentMethod } = req.body;

    if (!instructorId || !paymentMethod) {
      return res.status(400).json({ message: 'بيانات الدفع غير مكتملة' });
    }

    const instructor = await User.findOne({ _id: instructorId, role: 'admin', ...req.tenantFilter });
    if (!instructor) return res.status(404).json({ message: 'المدرس غير موجود' });

    const month = currentMonthString();
    const prevMonth = previousMonthString(month);

    // Same gate as createSubscription — re-checked here rather than trusted
    // from elsewhere, since this is the actual money-moving entry point.
    const prevSubscription = await Subscription.findOne({
      studentId: req.user._id,
      instructorId,
      stage: stageId,
      month: prevMonth
      , ...req.tenantFilter
    });
    if (prevSubscription && !prevSubscription.monthlyExamPassed) {
      return res.status(403).json({ message: 'يجب اجتياز اختبار الشهر السابق أولاً' });
    }

    const existing = await Subscription.findOne({
      studentId: req.user._id,
      instructorId,
      stage: stageId,
      month
      , ...req.tenantFilter
    });
    if (existing) {
      return res.status(400).json({ message: 'يوجد اشتراك بالفعل لهذا الشهر' });
    }

    if (paymentMethod === 'scratchcard') {
      // Wallet-based path: the student has ALREADY redeemed a scratch card
      // earlier (via scratchCardController.redeemScratchCard) and is now
      // spending wallet balance, not redeeming a code inline here — this
      // endpoint only checks and deducts the balance.
      const student = await User.findOne({ _id: req.user._id, ...req.tenantFilter });
      if (student.walletBalance < MONTHLY_SUBSCRIPTION_PRICE) {
        return res.status(400).json({ message: 'رصيد المحفظة غير كافٍ' });
      }

      student.walletBalance -= MONTHLY_SUBSCRIPTION_PRICE;
      await student.save();

      await Transaction.create({
        tenantId: req.user.tenantId,
        userId: req.user._id,
        type: 'purchase',
        source: 'wallet',
        amount: MONTHLY_SUBSCRIPTION_PRICE,
        status: 'success'
      });

      const startedAt = new Date();
      const expiresAt = new Date(startedAt);
      expiresAt.setDate(expiresAt.getDate() + 30);

      const subscription = await Subscription.create({
        tenantId: req.user.tenantId,
        studentId: req.user._id,
        instructorId,
        stage: stageId,
        month,
        status: 'active',
        startedAt,
        expiresAt
      });

      return res.status(201).json({ data: subscription });
    }

    if (paymentMethod === 'paymob') {
      // Kick off the same Paymob flow as course checkout, but for a
      // subscription rather than a specific course. The Subscription
      // record itself is created by the webhook handler once payment
      // actually succeeds (mirroring how course purchases create
      // LectureAccess only on webhook success, never optimistically here).
      //
      // NOTE: paymentController.startCourseCheckout is course-specific
      // (looks up course.price/course.instructorId). A parallel
      // subscription-checkout path would need its own axios calls against
      // MONTHLY_SUBSCRIPTION_PRICE and instructorId directly, plus the
      // webhook handler would need a transaction.type === 'subscription'
      // branch to create a Subscription instead of LectureAccess. That
      // branch is NOT implemented in this response — flagging it as a
      // follow-up needed in paymentController.js before the Paymob
      // subscription path is fully wired end-to-end; the scratchcard path
      // above is fully functional right now.
      return res.status(501).json({
        message: 'الدفع عبر Paymob للاشتراك الشهري غير مفعل بعد — استخدم بطاقة الشحن حالياً'
      });
    }

    return res.status(400).json({ message: 'طريقة دفع غير مدعومة' });
  } catch (err) {
    next(err);
  }
};
