const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { sendMessage, getThread, markMessageRead } = require('../controllers/messageController');

router.post('/', protect, tenantScope, authorize('parent', 'assistant', 'admin'), sendMessage);
router.get('/thread/:studentId', protect, tenantScope, getThread); // role/ownership checked inside
router.patch('/:id/read', protect, tenantScope, markMessageRead);

module.exports = router;
