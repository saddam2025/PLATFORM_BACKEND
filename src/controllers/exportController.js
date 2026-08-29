const User = require('../models/User');
const Subscription = require('../models/Subscription');

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

exports.exportStudents = async (req, res, next) => {
  try {
    const { instructorId } = req.params;

    if (String(req.user._id) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتصدير بيانات هذا الحساب' });
    }

    const students = await User.find({ instructorId, role: 'student', ...req.tenantFilter }).lean();

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const subscriptions = await Subscription.find({ instructorId, month: currentMonth, ...req.tenantFilter }).lean();
    const subStatusMap = new Map(subscriptions.map((s) => [String(s.studentId), s.status]));

    const columns = ['name', 'email', 'phone', 'stage', 'walletBalance', 'subscriptionStatus', 'joinedAt'];
    const headerRow = columns.join(',');

    const dataRows = students.map((s) => {
      // FIX: s.stage now resolves correctly — User schema has a real stage
      // field as of this batch, populated at registration time.
      const row = [
        s.name,
        s.email,
        s.phone || '',
        s.stage || '',
        s.walletBalance ?? 0,
        subStatusMap.get(String(s._id)) || 'none',
        s.createdAt ? new Date(s.createdAt).toISOString() : ''
      ];
      return row.map(csvEscape).join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\n');

    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="students-${dateStr}.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};
