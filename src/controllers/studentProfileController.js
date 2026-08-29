const User = require('../models/User');
const QuizSubmission = require('../models/QuizSubmission');
const VideoProgress = require('../models/VideoProgress');
const Assignment = require('../models/Assignment');
const Quiz = require('../models/Quiz');
const Course = require('../models/Course');

// GET /api/v1/instructors/:instructorId/students/:studentId/profile
// protect + authorize('admin','assistant') at route level.
exports.getStudentProfile = async (req, res, next) => {
  try {
    const { instructorId, studentId } = req.params;

    // OWASP A01 (BOLA) — this is the exact cross-tenant leak the whole
    // multi-tenant architecture exists to prevent:
    // 1) the target student must actually belong to THIS instructor's tenant
    // 2) if the requester is an assistant (not the admin themself), their
    //    OWN instructorId must also equal :instructorId — an assistant
    //    belonging to Instructor A must never be able to view a student
    //    belonging to Instructor B, even if they happen to guess a valid
    //    studentId.
    const student = await User.findOne({ _id: studentId, role: 'student', instructorId, ...req.tenantFilter });
    if (!student) {
      return res.status(404).json({ message: 'الطالب غير موجود' });
    }

    if (req.user.role === 'admin' && String(req.user._id) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا الطالب' });
    }

    if (req.user.role === 'assistant' && String(req.user.instructorId) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا الطالب' });
    }

    // Three independent queries — run in parallel via Promise.all rather
    // than sequential awaits, since none of them depend on each other's result.
    const [quizSubmissions, videoProgress, assignments] = await Promise.all([
      QuizSubmission.find({ studentId, ...req.tenantFilter }).sort({ submittedAt: -1 }).lean(),
      VideoProgress.find({ studentId, ...req.tenantFilter }).lean(),
      Assignment.find({ studentId, ...req.tenantFilter }).sort({ submittedAt: -1 }).lean()
    ]);

    // Populate quiz title / course title onto each submission manually
    // (cheaper than .populate() chains across two different ref paths per
    // submission, given quizId doesn't always have courseId set — e.g.
    // monthly exams).
    const quizIds = [...new Set(quizSubmissions.map((s) => String(s.quizId)))];
    const quizzes = await Quiz.find({ _id: { $in: quizIds }, ...req.tenantFilter }).lean();
    const quizMap = new Map(quizzes.map((q) => [String(q._id), q]));

    const courseIds = [
      ...new Set(
        quizzes.filter((q) => q.courseId).map((q) => String(q.courseId))
      )
    ];
    const courses = await Course.find({ _id: { $in: courseIds }, ...req.tenantFilter }).select('title_ar title_en').lean();
    const courseMap = new Map(courses.map((c) => [String(c._id), c]));

    const enrichedSubmissions = quizSubmissions.map((sub) => {
      const quiz = quizMap.get(String(sub.quizId));
      const course = quiz && quiz.courseId ? courseMap.get(String(quiz.courseId)) : null;
      return {
        ...sub,
        quizType: quiz ? quiz.type : null,
        courseTitle: course ? course.title_ar : quiz && quiz.type === 'monthly_exam' ? 'اختبار الشهر' : null
      };
    });

    // Attach course title onto each VideoProgress entry as well, for
    // display purposes (satisfies feature #2's "watch progress per video").
    const progressCourseIds = [...new Set(videoProgress.map((v) => String(v.courseId)))];
    const progressCourses = await Course.find({ _id: { $in: progressCourseIds }, ...req.tenantFilter }).select('title_ar').lean();
    const progressCourseMap = new Map(progressCourses.map((c) => [String(c._id), c]));

    const enrichedProgress = videoProgress.map((p) => ({
      ...p,
      courseTitle: progressCourseMap.get(String(p.courseId))?.title_ar || null
    }));

    res.json({
      data: {
        student: {
          name: student.name,
          email: student.email,
          phone: student.phone,
          joinedAt: student.createdAt
        },
        quizSubmissions: enrichedSubmissions,
        videoProgress: enrichedProgress,
        assignments
      }
    });
  } catch (err) {
    next(err);
  }
};
