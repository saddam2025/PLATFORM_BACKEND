const mongoose = require('mongoose');
const User = require('../models/User');
const { uploadImageFile } = require('../utils/r2Upload');

function getTenantFilter(req) {
  return req.tenantFilter || { tenantId: req.user.tenantId };
}

function isOwnerOfInstructor(user, instructorId) {
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

// Shared by lecture quizzes and standalone exams. The image is uploaded only
// after ownership and tenant checks; r2Upload validates the real signature.
exports.uploadQuestionImage = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    if (!mongoose.isValidObjectId(instructorId) || !isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك برفع صورة السؤال' });
    }
    const instructor = await User.findOne({ _id: instructorId, role: 'admin', ...getTenantFilter(req) }).select('_id').lean();
    if (!instructor) return res.status(404).json({ message: 'المدرس غير موجود' });
    const imageUrl = await uploadImageFile(req.file, `question-stems/${req.user.tenantId}`, 'Question image');
    return res.status(201).json({ data: { imageUrl } });
  } catch (err) {
    next(err);
  }
};
