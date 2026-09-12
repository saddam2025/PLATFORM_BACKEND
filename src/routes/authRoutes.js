const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { uploadAvatar } = require('../middlewares/uploadMiddleware');
const {
  register,
  login,
  me,
  logout,
  updateMyAvatar,
  acceptInvite,
  setupMfa,
  confirmMfa,
  disableMfa,
  verifyMfaLogin
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/mfa/verify-login', verifyMfaLogin);
router.get('/me', protect, me);
router.post('/mfa/setup', protect, authorize('admin', 'assistant', 'super_admin'), setupMfa);
router.post('/mfa/confirm', protect, authorize('admin', 'assistant', 'super_admin'), confirmMfa);
router.post('/mfa/disable', protect, authorize('admin', 'assistant', 'super_admin'), disableMfa);
router.patch('/me/avatar', protect, uploadAvatar, updateMyAvatar);
router.post('/logout', logout);
router.post('/accept-invite/:token', acceptInvite); // public — token is the credential

module.exports = router;
