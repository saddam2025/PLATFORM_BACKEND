const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { sendMessage, getThread, markMessageRead } = require('../controllers/messageController');

router.post('/', protect, authorize('parent', 'assistant', 'admin'), sendMessage);
router.get('/thread/:studentId', protect, getThread); // role/ownership checked inside
router.patch('/:id/read', protect, markMessageRead);

module.exports = router;