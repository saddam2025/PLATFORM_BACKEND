const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { uploadAvatar } = require('../middlewares/uploadMiddleware');
const {
  register,
  login,
  me,
  logout,
  updateMyAvatar,
  acceptInvite
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, me);
router.patch('/me/avatar', protect, uploadAvatar, updateMyAvatar);
router.post('/logout', logout);
router.post('/accept-invite/:token', acceptInvite); // public — token is the credential

module.exports = router;
