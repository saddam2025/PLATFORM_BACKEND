const Notification = require('../models/Notification');

// GET /api/v1/notifications?page=&limit=
exports.listNotifications = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find({ recipientId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments({ recipientId: req.user._id })
    ]);

    res.json({
      data: notifications,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/notifications/unread-count
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ recipientId: req.user._id, read: false });
    res.json({ data: { count } });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/notifications/:id/read
exports.markRead = async (req, res, next) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ message: 'الإشعار غير موجود' });
    }

    // Ownership check — a user can only mark THEIR OWN notifications as read.
    if (String(notification.recipientId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بهذا الإجراء' });
    }

    notification.read = true;
    await notification.save();
    res.json({ data: notification });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/notifications/read-all
exports.markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipientId: req.user._id, read: false },
      { $set: { read: true } }
    );
    res.json({ message: 'تم تعليم جميع الإشعارات كمقروءة' });
  } catch (err) {
    next(err);
  }
};