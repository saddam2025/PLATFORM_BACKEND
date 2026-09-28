const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { generateScratchCards, listScratchCards, redeemScratchCard, deleteScratchCard, deleteScratchCardBatch, deleteAllScratchCards } = require('../controllers/scratchCardController');

const gateGenerate = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_generate_wallet_codes')(req, res, next);
};

router.post(
  '/instructors/:instructorId/scratchcards/generate',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  gateGenerate,
  generateScratchCards
);
router.get('/instructors/:instructorId/scratchcards', protect, tenantScope, authorize('admin', 'assistant'), gateGenerate, listScratchCards);
router.delete('/instructors/:instructorId/scratchcards/:cardId', protect, tenantScope, authorize('admin', 'assistant'), gateGenerate, deleteScratchCard);
router.delete('/instructors/:instructorId/scratchcard-batches', protect, tenantScope, authorize('admin', 'assistant'), gateGenerate, deleteScratchCardBatch);
router.delete('/instructors/:instructorId/scratchcards', protect, tenantScope, authorize('admin', 'assistant'), gateGenerate, deleteAllScratchCards);

router.post('/scratchcards/redeem', protect, tenantScope, authorize('student'), redeemScratchCard);

module.exports = router;
