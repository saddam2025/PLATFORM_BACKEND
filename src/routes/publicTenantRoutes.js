const express = require('express');
const { listPublicTenants, getPublicTenant } = require('../controllers/publicTenantController');

const router = express.Router();
router.get('/public', listPublicTenants);
router.get('/public/:subdomain', getPublicTenant);

module.exports = router;
