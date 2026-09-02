const Message = require('../models/Message');
const User = require('../models/User');

function parsePagination(query) {
  const parsePositiveInteger = (value, name, defaultValue, max) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      return { error: `${name} يجب أن يكون عدداً صحيحاً موجباً` };
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || (max && parsed > max)) {
      return { error: max ? `${name} يجب ألا يتجاوز ${max}` : `${name} غير صالح` };
    }
    return parsed;
  };

  const page = parsePositiveInteger(query.page, 'page', 1);
  const limit = parsePositiveInteger(query.limit, 'limit', 20, 50);
  if (typeof page === 'object' || typeof limit === 'object') {
    return { error: page.error || limit.error };
  }
  return { page, limit };
}

// POST /api/v1/messages
// protect + authorize('parent','assistant','admin').
exports.sendMessage = async (req, res, next) => {
  try {
    const { toUserId, studentId, body } = req.body;

    if (!toUserId || !studentId || !body) {
      return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }

    const student = await User.findOne({ _id: studentId, role: 'student', ...req.tenantFilter });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    const recipient = await User.findOne({ _id: toUserId, ...req.tenantFilter });
    if (!recipient) {
      return res.status(404).json({ message: 'المستلم غير موجود' });
    }

    // Ownership/scope check per sender role:
    if (req.user.role === 'parent') {
      // A parent can only message about THEIR OWN child — never impersonate
      // a message about someone else's child, even if they know the
      // studentId. This is the exact OWASP A01 concern the prompt flags.
      if (String(req.user.childId) !== String(studentId)) {
        return res.status(403).json({ message: 'غير مصرح لك بالمراسلة بخصوص هذا الطالب' });
      }
      if (recipient.role !== 'assistant' || String(recipient.instructorId) !== String(student.instructorId)) {
        return res.status(403).json({ message: 'يمكنك مراسلة مساعد الطالب المعيّن فقط' });
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
      tenantId: req.user.tenantId,
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

    const student = await User.findOne({ _id: studentId, role: 'student', ...req.tenantFilter });
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

    let messageFilter = { studentId, ...req.tenantFilter };
    if (req.user.role === 'parent') {
      const assistants = await User.find({ role: 'assistant', instructorId: student.instructorId, ...req.tenantFilter }).select('_id');
      const assistantIds = assistants.map((assistant) => assistant._id);
      messageFilter = {
        ...messageFilter,
        $or: [
          { fromUserId: req.user._id, toUserId: { $in: assistantIds } },
          { toUserId: req.user._id, fromUserId: { $in: assistantIds } }
        ]
      };
    }
    const messages = await Message.find(messageFilter).sort({ createdAt: 1 });
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
    const message = await Message.findOne({ _id: req.params.id, ...req.tenantFilter });
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

// GET /api/v1/messages/conversations?page=&limit=
// Returns only message-backed conversations. A parent is limited to their own
// child and assistants assigned to that child's instructor, exactly matching
// the authorization relationship enforced by sendMessage/getThread.
exports.listConversations = async (req, res, next) => {
  try {
    const { page, limit, error } = parsePagination(req.query);
    if (error) return res.status(400).json({ message: error });

    const baseMatch = { ...req.tenantFilter };
    let pipeline;
    let participantType;

    if (req.user.role === 'parent') {
      const child = await User.findOne({
        _id: req.user.childId,
        role: 'student',
        ...req.tenantFilter
      }).select('instructorId').lean();
      if (!child) return res.status(404).json({ message: 'الطالب غير موجود' });

      const assistants = await User.find({
        role: 'assistant',
        instructorId: child.instructorId,
        ...req.tenantFilter
      }).select('_id').lean();
      const assistantIds = assistants.map((assistant) => assistant._id);
      participantType = 'assistant';
      pipeline = [
        {
          $match: {
            ...baseMatch,
            studentId: child._id,
            $or: [
              { fromUserId: req.user._id, toUserId: { $in: assistantIds } },
              { toUserId: req.user._id, fromUserId: { $in: assistantIds } }
            ]
          }
        },
        {
          $set: {
            participantId: {
              $cond: [{ $eq: ['$fromUserId', req.user._id] }, '$toUserId', '$fromUserId']
            }
          }
        }
      ];
    } else {
      // An assistant/admin sees only conversations they are personally party
      // to. The lookup proves that the other participant is the parent whose
      // child is the message's student context; unrelated tenant messages are
      // not surfaced as inbox items.
      participantType = 'parent';
      pipeline = [
        {
          $match: {
            ...baseMatch,
            $or: [{ fromUserId: req.user._id }, { toUserId: req.user._id }]
          }
        },
        {
          $set: {
            participantId: {
              $cond: [{ $eq: ['$fromUserId', req.user._id] }, '$toUserId', '$fromUserId']
            }
          }
        },
        {
          $lookup: {
            from: 'users',
            let: { parentId: '$participantId', childId: '$studentId', tenantId: '$tenantId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$_id', '$$parentId'] },
                      { $eq: ['$role', 'parent'] },
                      { $eq: ['$childId', '$$childId'] },
                      { $eq: ['$tenantId', '$$tenantId'] }
                    ]
                  }
                }
              },
              { $project: { name: 1, avatarUrl: 1 } }
            ],
            as: 'participant'
          }
        },
        { $unwind: '$participant' }
      ];
    }

    pipeline.push(
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { participantId: '$participantId', studentId: '$studentId' },
          lastMessage: { $first: { body: '$body', createdAt: '$createdAt' } },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$toUserId', req.user._id] }, { $eq: ['$read', false] }] },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { 'lastMessage.createdAt': -1 } },
      {
        $facet: {
          data: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'count' }]
        }
      }
    );

    const [result] = await Message.aggregate(pipeline);
    const summaries = result.data || [];
    const participantIds = summaries.map((summary) => summary._id.participantId);
    const participants = await User.find({
      _id: { $in: participantIds },
      role: participantType,
      ...req.tenantFilter
    }).select('name avatarUrl').lean();
    const participantsById = new Map(participants.map((participant) => [String(participant._id), participant]));

    const data = summaries.flatMap((summary) => {
      const participant = participantsById.get(String(summary._id.participantId));
      if (!participant) return [];
      const item = {
        studentId: summary._id.studentId,
        lastMessagePreview: summary.lastMessage.body,
        lastMessageAt: summary.lastMessage.createdAt,
        unreadCount: summary.unreadCount
      };
      if (participantType === 'assistant') {
        item.assistantId = participant._id;
        item.assistant = { name: participant.name, avatarUrl: participant.avatarUrl || null };
      } else {
        item.parentId = participant._id;
        item.parent = { name: participant.name, avatarUrl: participant.avatarUrl || null };
      }
      return [item];
    });
    const total = result.total?.[0]?.count || 0;
    res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};
