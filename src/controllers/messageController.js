const Message = require('../models/Message');
const User = require('../models/User');

// POST /api/v1/messages
// protect + authorize('parent','assistant','admin').
exports.sendMessage = async (req, res, next) => {
  try {
    const { toUserId, studentId, body } = req.body;

    if (!toUserId || !studentId || !body) {
      return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    // Ownership/scope check per sender role:
    if (req.user.role === 'parent') {
      // A parent can only message about THEIR OWN child — never impersonate
      // a message about someone else's child, even if they know the
      // studentId. This is the exact OWASP A01 concern the prompt flags.
      if (String(req.user.childId) !== String(studentId)) {
        return res.status(403).json({ message: 'غير مصرح لك بالمراسلة بخصوص هذا الطالب' });
      }
    } else if (req.user.role === 'assistant' || req.user.role === 'admin') {
      // studentId must belong to a student within the sender's OWN
      // instructorId tenant — an assistant/admin cannot message about a
      // student belonging to a different instructor.
      const senderInstructorId = req.user.role === 'admin' ? req.user._id : req.user.instructorId;
      if (String(student.instructorId) !== String(senderInstructorId)) {
        return res.status(403).json({ message: 'غير مصرح لك بالمراسلة بخصوص هذا الطالب' });
      }
    }

    const message = await Message.create({
      fromUserId: req.user._id,
      toUserId,
      instructorId: student.instructorId,
      studentId,
      body
    });

    res.status(201).json({ data: message });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/messages/thread/:studentId
// protect. Same ownership/scope check as sendMessage.
exports.getThread = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    const student = await User.findOne({ _id: studentId, role: 'student' });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    if (req.user.role === 'parent') {
      if (String(req.user.childId) !== String(studentId)) {
        return res.status(403).json({ message: 'غير مصرح لك بعرض هذه المحادثة' });
      }
    } else if (req.user.role === 'assistant' || req.user.role === 'admin') {
      const requesterInstructorId = req.user.role === 'admin' ? req.user._id : req.user.instructorId;
      if (String(student.instructorId) !== String(requesterInstructorId)) {
        return res.status(403).json({ message: 'غير مصرح لك بعرض هذه المحادثة' });
      }
    } else {
      // students themselves are not part of this messaging flow per the spec
      // (parent <-> assistant/admin only)
      return res.status(403).json({ message: 'غير مصرح لك بعرض هذه المحادثة' });
    }

    const messages = await Message.find({ studentId }).sort({ createdAt: 1 });
    res.json({ data: messages });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/v1/messages/:id/read
// protect, ownership check — only the recipient can mark their own
// received message as read.
exports.markMessageRead = async (req, res, next) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة' });
    }

    if (String(message.toUserId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'غير مصرح لك بهذا الإجراء' });
    }

    message.read = true;
    await message.save();
    res.json({ data: message });
  } catch (err) {
    next(err);
  }
};