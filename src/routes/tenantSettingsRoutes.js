const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { getOwnTenantSettings, updateOwnTenantSettings } = require('../controllers/tenantSettingsController');

const router = express.Router();
router.get('/:instructorId/settings', protect, tenantScope, authorize('admin'), getOwnTenantSettings);
router.patch('/:instructorId/settings', protect, tenantScope, authorize('admin'), updateOwnTenantSettings);

module.exports = router;
