const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  listTenants,
  createTenant,
  getTenant,
  updateTenant,
  deleteTenant,
  getTenantStats
} = require('../controllers/superAdminController');

const router = express.Router();

router.use(protect, authorize('super_admin'));
router.get('/tenants', listTenants);
router.post('/tenants', createTenant);
router.get('/tenants/:id', getTenant);
router.patch('/tenants/:id', updateTenant);
router.delete('/tenants/:id', deleteTenant);
router.get('/tenants/:id/stats', getTenantStats);

module.exports = router;
