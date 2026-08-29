const express = require('express');
const router = express.Router();
const { protect, authorize, requirePermission } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadVideo } = require('../middlewares/uploadMiddleware');
const { createReel, listReels, incrementView, deleteReel } = require('../controllers/reelController');

const gateVideoUpload = (req, res, next) => {
  if (req.user.role === 'admin') return next();
  return requirePermission('can_upload_video')(req, res, next);
};

router.post(
  '/instructors/:instructorId/reels',
  protect,
  tenantScope,
  authorize('admin', 'assistant'),
  uploadVideo.single('video'),
  gateVideoUpload,
  createReel
);

router.get('/instructors/:instructorId/reels', protect, tenantScope, authorize('student'), listReels);
router.patch('/reels/:reelId/view', protect, tenantScope, authorize('student'), incrementView);
router.delete('/reels/:reelId', protect, tenantScope, authorize('admin', 'assistant'), deleteReel);

module.exports = router;
