const express = require('express');
const router = express.Router();
const { getLeaderboard } = require('../controllers/leaderboardController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');

router.get('/:instructorId/leaderboard', protect, tenantScope, authorize('student', 'parent', 'admin', 'assistant'), getLeaderboard);

module.exports = router;
