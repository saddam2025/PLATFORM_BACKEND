const mongoose = require('mongoose');
const User = require('../models/User');

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
    if (!mongoose.isValidObjectId(instructorId)) {
      return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    }
    const instructorObjectId = new mongoose.Types.ObjectId(instructorId);
    const instructor = await User.findOne({ _id: instructorObjectId, role: 'admin', isActive: true }).select('tenantId').lean();
    if (!instructor?.tenantId) return res.status(404).json({ message: 'المدرس غير موجود' });
    const tenantObjectId = new mongoose.Types.ObjectId(instructor.tenantId);

    const studentMatch = { instructorId: instructorObjectId, role: 'student', tenantId: tenantObjectId };
    if (stage) studentMatch.stage = stage;

    // Exam averages: join QuizSubmission -> User (student), filtered to this
    // instructor's students, grouped by student.
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
          $addFields: {
            examAvg: {
              $cond: [
                { $gt: [{ $size: '$submissions' }, 0] },
                { $avg: '$submissions.score' },
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
