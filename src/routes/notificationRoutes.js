const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  listNotifications,
  getUnreadCount,
  markRead,
  markAllRead
} = require('../controllers/notificationController');

router.get('/', protect, tenantScope, listNotifications);
router.get('/unread-count', protect, tenantScope, getUnreadCount);
router.patch('/:id/read', protect, tenantScope, markRead);
router.patch('/read-all', protect, tenantScope, markAllRead);

module.exports = router;
