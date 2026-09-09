const mongoose = require('mongoose');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { STAGE_ENUM } = require('../constants/stages');
const { settleExpiredStandaloneExamSubmissions } = require('../services/standaloneExamSubmissionService');

async function resolveInstructor(instructorId) {
  if (mongoose.isValidObjectId(instructorId)) {
    return User.findOne({ _id: instructorId, role: 'admin', isActive: true }).select('_id tenantId').lean();
  }

  // Public routes use the tenant subdomain (for example, "sohag"), while
  // internal records use the admin's ObjectId. Resolve the public identifier
  // instead of rejecting it as an invalid ObjectId.
  const tenant = await Tenant.findOne({ subdomain: instructorId, isActive: true, deletedAt: null }).select('_id ownerId').lean();
  if (!tenant?.ownerId) return null;
  return { _id: tenant.ownerId, tenantId: tenant._id };
}

// GET /api/v1/instructors/:instructorId/leaderboard?stage=
// Public route — LeaderboardPage.jsx has auth:null, visible to
// students/parents/teachers/assistants without a specific role requirement.
//
// WEIGHTING FLAG: totalScore below is a straight 50/50 average of
// homeworkAvg and examAvg. This split is arbitrary and adjustable — the
// teacher may want exams weighted more heavily than homework (or vice
// versa). Change the 0.5/0.5 multipliers in the $addFields stage if so.
//
// CACHE FLAG: this aggregation pipeline scans QuizSubmission and Assignment
// across every student of the instructor on every request. At scale this
// could be expensive. A short TTL cache (e.g. 5 minutes, keyed by
// instructorId+stage) would be a good addition later — NOT implemented
// here, out of scope for this batch.
exports.getLeaderboard = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { stage } = req.query;
    if (stage && !STAGE_ENUM.includes(stage)) {
      return res.status(400).json({ message: 'المرحلة الدراسية غير صالحة' });
    }
    const instructor = await resolveInstructor(instructorId);
    if (!instructor?.tenantId) return res.status(404).json({ message: 'المدرس غير موجود' });
    // Authenticated viewers can only read their own tenant's board. The
    // route supplies tenantScope for every allowed role, so an instructor id
    // from another tenant must not select a different leaderboard.
    if (req.tenantFilter?.tenantId && String(instructor.tenantId) !== String(req.tenantFilter.tenantId)) {
      return res.status(404).json({ message: 'المدرس غير موجود' });
    }
    const instructorObjectId = new mongoose.Types.ObjectId(instructor._id);
    const tenantObjectId = new mongoose.Types.ObjectId(instructor.tenantId);

    // Leaderboard is also a score-read surface, so close abandoned attempts
    // before aggregation rather than leaving them indefinitely ungraded.
    await settleExpiredStandaloneExamSubmissions({ filter: { tenantId: tenantObjectId } });

    const studentMatch = { instructorId: instructorObjectId, role: 'student', tenantId: tenantObjectId };
    if (stage) studentMatch.stage = stage;

    // Exam averages: join both QuizSubmission and StandaloneExamSubmission
    // for this instructor's students, then average their combined scores.
    const examAggPromise = mongoose.connection.db
      .collection('users')
      .aggregate([
        { $match: studentMatch },
        {
          $lookup: {
            from: 'quizsubmissions',
            let: { studentId: '$_id' },
            pipeline: [{ $match: { $expr: { $and: [
              { $eq: ['$studentId', '$$studentId'] },
              { $eq: ['$tenantId', tenantObjectId] }
            ] } } }],
            as: 'submissions'
          }
        },
        {
          $lookup: {
            from: 'standaloneexamsubmissions',
            let: { studentId: '$_id' },
            pipeline: [{ $match: { $expr: { $and: [
              { $eq: ['$studentId', '$$studentId'] },
              { $eq: ['$tenantId', tenantObjectId] },
              { $ne: ['$score', null] }
            ] } } }],
            as: 'standaloneExamSubmissions'
          }
        },
        {
          $addFields: {
            examAvg: {
              $cond: [
                { $gt: [{ $size: { $concatArrays: ['$submissions', '$standaloneExamSubmissions'] } }, 0] },
                { $avg: { $concatArrays: ['$submissions.score', '$standaloneExamSubmissions.score'] } },
                0
              ]
            }
          }
        },
        { $project: { name: 1, avatar: 1, stage: 1, examAvg: 1 } }
      ])
      .toArray();

    // Homework averages: join Assignment -> User (student) the same way.
    const homeworkAggPromise = mongoose.connection.db
      .collection('users')
      .aggregate([
        { $match: studentMatch },
        {
          $lookup: {
            from: 'assignments',
            let: { studentId: '$_id' },
            pipeline: [{ $match: { $expr: { $and: [
              { $eq: ['$studentId', '$$studentId'] },
              { $eq: ['$tenantId', tenantObjectId] }
            ] } } }],
            as: 'assignments'
          }
        },
        {
          $addFields: {
            gradedAssignments: {
              $filter: {
                input: '$assignments',
                as: 'a',
                cond: { $ne: ['$$a.grade', null] }
              }
            }
          }
        },
        {
          $addFields: {
            homeworkAvg: {
              $cond: [
                { $gt: [{ $size: '$gradedAssignments' }, 0] },
                { $avg: '$gradedAssignments.grade' },
                0
              ]
            }
          }
        },
        { $project: { homeworkAvg: 1 } }
      ])
      .toArray();

    const [examResults, homeworkResults] = await Promise.all([examAggPromise, homeworkAggPromise]);

    const homeworkMap = new Map(homeworkResults.map((h) => [String(h._id), h.homeworkAvg]));

    const merged = examResults.map((s) => {
      const examAvg = Math.round(s.examAvg || 0);
      const homeworkAvg = Math.round(homeworkMap.get(String(s._id)) || 0);
      // 50/50 weighting — see WEIGHTING FLAG comment above.
      const totalScore = Math.round(examAvg * 0.5 + homeworkAvg * 0.5);

      return {
        studentId: s._id,
        name: s.name,
        avatar: s.avatar || null,
        stage: s.stage,
        homeworkAvg,
        examAvg,
        totalScore
      };
    });

    merged.sort((a, b) => b.totalScore - a.totalScore);
    const top15 = merged.slice(0, 15);

    res.json({ data: top15 });
  } catch (err) {
    next(err);
  }
};
