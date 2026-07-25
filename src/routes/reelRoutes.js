const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const { uploadVideo } = require('../middlewares/uploadMiddleware');
const { createReel, listReels, incrementView, deleteReel } = require('../controllers/reelController');

const gateVideoUpload = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_upload_video')(req, res, next);
};

router.post(
  '/instructors/:instructorId/reels',
  protect,
  authorize('admin', 'assistant'),
  uploadVideo.single('video'),
  gateVideoUpload,
  createReel
);

router.get('/instructors/:instructorId/reels', protect, authorize('student'), listReels);
router.patch('/reels/:reelId/view', protect, authorize('student'), incrementView);
router.delete('/reels/:reelId', protect, authorize('admin', 'assistant'), deleteReel);

module.exports = router;