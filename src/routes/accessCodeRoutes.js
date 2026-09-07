const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { generateAccessCodes, listAccessCodeBatches, redeemAccessCode } = require('../controllers/accessCodeController');

const gateGenerate = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_generate_access_codes')(req, res, next);
};

router.post(
  '/instructors/:instructorId/courses/:courseId/access-codes/generate',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  gateGenerate,
  generateAccessCodes
);

router.get('/instructors/:instructorId/access-code-batches', protect, tenantScope, authorize('admin', 'assistant'), listAccessCodeBatches);

router.post('/access-codes/redeem', protect, tenantScope, authorize('student'), redeemAccessCode);

module.exports = router;
