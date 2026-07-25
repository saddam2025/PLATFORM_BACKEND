const User = require('../models/User');
const Notification = require('../models/Notification');

// Internal helper, not a route. Bulk-inserts Notification docs for an entire
// audience (students, parents, or both) belonging to instructorId — uses
// insertMany rather than a loop of individual .save() calls, since this
// could be hundreds of recipients and N sequential writes would be slow
// and put unnecessary load on the DB connection pool.
async function createNotificationsForAudience({ instructorId, type, title, body, relatedId, audience }) {
  const roles = [];
  if (audience === 'students' || audience === 'both') roles.push('student');
  if (audience === 'parents' || audience === 'both') roles.push('parent');

  if (roles.length === 0) return;

  const recipients = await User.find({ instructorId, role: { $in: roles } }).select('_id');
  if (recipients.length === 0) return;

  const docs = recipients.map((r) => ({
    recipientId: r._id,
    instructorId,
    type,
    title,
    body,
    relatedId: relatedId || null
  }));

  await Notification.insertMany(docs);
}

module.exports = createNotificationsForAudience;