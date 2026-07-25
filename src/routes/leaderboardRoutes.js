const express = require('express');
const router = express.Router();
const { getLeaderboard } = require('../controllers/leaderboardController');

// Public — no protect() middleware, matching the frontend's auth: null route.
router.get('/:instructorId/leaderboard', getLeaderboard);

module.exports = router;