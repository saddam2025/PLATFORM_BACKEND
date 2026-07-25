const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  createAssistant,
  listAssistants,
  updateAssistantPermissions
} = require('../controllers/userController');

// All routes here require an authenticated admin. Ownership of the specific
// :instructorId tenant is checked again inside each controller (BOLA — role
// alone isn't enough, the admin must own THIS tenant).
router.post('/:instructorId/assistants', protect, authorize('admin'), createAssistant);
router.get('/:instructorId/assistants', protect, authorize('admin'), listAssistants);
router.patch('/:instructorId/assistants/:assistantId', protect, authorize('admin'), updateAssistantPermissions);

module.exports = router;