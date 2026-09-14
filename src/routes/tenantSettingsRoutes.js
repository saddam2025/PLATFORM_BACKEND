const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadBrandingImage } = require('../middlewares/uploadMiddleware');
const { getOwnTenantSettings, updateOwnTenantSettings, uploadOwnTenantBrandAsset } = require('../controllers/tenantSettingsController');

const router = express.Router();
router.get('/:instructorId/settings', protect, tenantScope, authorize('admin'), getOwnTenantSettings);
router.patch('/:instructorId/settings', protect, tenantScope, authorize('admin'), updateOwnTenantSettings);
router.post('/:instructorId/settings/branding/:assetType', protect, tenantScope, authorize('admin'), uploadBrandingImage, uploadOwnTenantBrandAsset);

module.exports = router;
