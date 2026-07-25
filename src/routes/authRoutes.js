const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
  register,
  login,
  me,
  logout,
  acceptInvite
} = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, me);
router.post('/logout', logout);
router.post('/accept-invite/:token', acceptInvite); // public — token is the credential

module.exports = router;