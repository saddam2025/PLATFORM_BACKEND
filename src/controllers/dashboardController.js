const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const Transaction = require('../models/Transaction');

const MONTHS_TO_INCLUDE = 6;

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function recentMonthKeys(count) {
  const months = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - index, 1));
    months.push(monthKey(date));
  }
  return months;
}

function startOfEarliestMonth() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() - (MONTHS_TO_INCLUDE - 1));
  return date;
}

function assertOwner(req) {
  if (!mongoose.isValidObjectId(req.params.instructorId)) return false;
  return String(req.user._id) === String(req.params.instructorId);
}

// GET /api/v1/instructors/:instructorId/dashboard/summary
exports.getDashboardSummary = async (req, res, next) => {
  try {
    if (!assertOwner(req)) return res.status(403).json({ message: 'غير مصرح لك بعرض لوحة مؤسسة أخرى' });
    const tenantId = req.user.tenantId;
    const transactionMatch = { tenantId, status: 'success' };
    const recentTransactionMatch = { ...transactionMatch, createdAt: { $gte: startOfEarliestMonth() } };
    let pendingGradingPromise;
    let pendingGradingAvailable = true;
    try {
      // Kept lazy so the dashboard can still operate during deployments where
      // the Assignment feature has not yet been released.
      const Assignment = require('../models/Assignment');
      pendingGradingPromise = Assignment.countDocuments({ tenantId, status: 'pending' });
    } catch {
      pendingGradingAvailable = false;
      pendingGradingPromise = Promise.resolve(0);
    }

    const [activeStudents, publishedCourses, pendingGrading, monthTotals, sourceTotals] = await Promise.all([
      User.countDocuments({ tenantId, role: 'student' }),
      Course.countDocuments({ tenantId, isPublished: true }),
      pendingGradingPromise,
      Transaction.aggregate([
        { $match: recentTransactionMatch },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, amount: { $sum: '$amount' } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      Transaction.aggregate([
        { $match: transactionMatch },
        { $group: { _id: '$source', amount: { $sum: '$amount' } } },
        { $sort: { amount: -1, _id: 1 } }
      ])
    ]);

    const totalsByMonth = new Map(monthTotals.map((item) => [`${item._id.year}-${String(item._id.month).padStart(2, '0')}`, item.amount]));
    const revenueSeries = recentMonthKeys(MONTHS_TO_INCLUDE).map((month) => ({ month, amount: totalsByMonth.get(month) || 0 }));
    const revenueBySource = sourceTotals.map((item) => ({ source: item._id || 'other', amount: item.amount }));
    const monthlyRevenue = revenueSeries.at(-1)?.amount || 0;

    res.json({ data: { activeStudents, publishedCourses, pendingGrading, pendingGradingAvailable, monthlyRevenue, revenueSeries, revenueBySource } });
  } catch (err) {
    next(err);
  }
};
