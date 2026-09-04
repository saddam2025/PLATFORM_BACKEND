const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const {
  createAssistant,
  listAssistants,
  updateAssistantPermissions,
  suspendAssistant,
  reactivateAssistant,
  deleteAssistant,
  getAssistantProfile
} = require('../controllers/userController');

// All routes here require an authenticated admin. Ownership of the specific
// :instructorId tenant is checked again inside each controller (BOLA — role
// alone isn't enough, the admin must own THIS tenant).
router.post('/:instructorId/assistants', protect, tenantScope, authorize('admin'), createAssistant);
router.get('/:instructorId/assistants', protect, tenantScope, authorize('admin'), listAssistants);
router.patch('/:instructorId/assistants/:assistantId', protect, tenantScope, authorize('admin'), updateAssistantPermissions);
router.patch('/:instructorId/assistants/:assistantId/suspend', protect, tenantScope, authorize('admin'), suspendAssistant);
router.patch('/:instructorId/assistants/:assistantId/reactivate', protect, tenantScope, authorize('admin'), reactivateAssistant);
router.delete('/:instructorId/assistants/:assistantId', protect, tenantScope, authorize('admin'), deleteAssistant);

// Parents may view only the assistant assigned to their child's instructor;
// that relationship check happens in getAssistantProfile. Students are
// intentionally excluded: there is no approved student-facing requirement.
router.get('/:id/assistant-profile', protect, tenantScope, authorize('parent', 'admin'), getAssistantProfile);

module.exports = router;
