const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { generateScratchCards, redeemScratchCard } = require('../controllers/scratchCardController');

const gateGenerate = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_generate_access_codes')(req, res, next);
};

router.post(
  '/instructors/:instructorId/scratchcards/generate',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  gateGenerate,
  generateScratchCards
);

router.post('/scratchcards/redeem', protect, tenantScope, authorize('student'), redeemScratchCard);

module.exports = router;
