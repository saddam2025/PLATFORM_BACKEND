const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const { generateAccessCodes, redeemAccessCode } = require('../controllers/accessCodeController');

const gateGenerate = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_generate_access_codes')(req, res, next);
};

router.post(
  '/instructors/:instructorId/courses/:courseId/access-codes/generate',
  protect,
  authorize('admin', 'assistant'),
  gateGenerate,
  generateAccessCodes
);

router.post('/access-codes/redeem', protect, authorize('student'), redeemAccessCode);

module.exports = router;