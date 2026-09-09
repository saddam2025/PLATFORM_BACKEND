const User = require('../models/User');
const QuizSubmission = require('../models/QuizSubmission');
const VideoProgress = require('../models/VideoProgress');
const Assignment = require('../models/Assignment');
const Quiz = require('../models/Quiz');
const StandaloneExam = require('../models/StandaloneExam');
const StandaloneExamSubmission = require('../models/StandaloneExamSubmission');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const LectureAccess = require('../models/LectureAccess');
const CourseEnrollment = require('../models/CourseEnrollment');
const mongoose = require('mongoose');
const { settleExpiredStandaloneExamSubmissions } = require('../services/standaloneExamSubmissionService');

function canViewInstructorStudents(user, instructorId) {
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

function paginationFromQuery(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit };
}

// GET /api/v1/instructors/:instructorId/students?page=&limit=&search=
exports.listInstructorStudents = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    if (!mongoose.isValidObjectId(instructorId)) return res.status(400).json({ message: 'معرف المدرس غير صالح' });
    if (!canViewInstructorStudents(req.user, instructorId)) return res.status(403).json({ message: 'غير مصرح لك بعرض طلاب هذا الحساب' });

    const { page, limit } = paginationFromQuery(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const filter = { instructorId, role: 'student', ...req.tenantFilter };
    if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const [students, total] = await Promise.all([
      User.find(filter).select('name email phone fatherPhone motherPhone stage track avatarUrl createdAt').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter)
    ]);
    return res.json({ data: students, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/instructors/:instructorId/students/:studentId
exports.getStudentDirectoryDetail = async (req, res, next) => {
  try {
    const { instructorId, studentId } = req.params;
    if (!mongoose.isValidObjectId(instructorId) || !mongoose.isValidObjectId(studentId)) return res.status(400).json({ message: 'معرف الطالب أو المدرس غير صالح' });
    if (!canViewInstructorStudents(req.user, instructorId)) return res.status(403).json({ message: 'غير مصرح لك بعرض بيانات هذا الطالب' });

    // No sensitive fields are selected. The response is deliberately built
    // from an allowlist rather than serializing the full User document.
    const student = await User.findOne({ _id: studentId, instructorId, role: 'student', ...req.tenantFilter })
      .select('name email phone fatherPhone motherPhone stage track avatarUrl createdAt');
    if (!student) return res.status(404).json({ message: 'الطالب غير موجود' });

    const [lectureAccess, enrollments] = await Promise.all([
      LectureAccess.find({ studentId: student._id, ...req.tenantFilter }).sort({ purchasedAt: -1 }).lean(),
      CourseEnrollment.find({ studentId: student._id, ...req.tenantFilter })
        .populate({ path: 'courseId', match: req.tenantFilter, select: 'title_ar title_en' })
        .sort({ purchasedAt: -1 })
        .lean()
    ]);

    // Legacy LectureAccess rows may store either a course id (full access)
    // or a lecture id (single-lecture access); resolve both without guessing.
    const accessIds = lectureAccess.map((item) => item.courseId).filter(Boolean);
    const [lectures, courses] = await Promise.all([
      accessIds.length ? Lecture.find({ _id: { $in: accessIds }, ...req.tenantFilter }).select('title_ar title_en courseId').lean() : [],
      accessIds.length ? Course.find({ _id: { $in: accessIds }, ...req.tenantFilter }).select('title_ar title_en').lean() : []
    ]);
    const lectureById = new Map(lectures.map((item) => [String(item._id), item]));
    const courseById = new Map(courses.map((item) => [String(item._id), item]));

    return res.json({
      data: {
        student: {
          id: student._id,
          name: student.name,
          email: student.email,
          phone: student.phone,
          fatherPhone: student.fatherPhone,
          motherPhone: student.motherPhone,
          stage: student.stage,
          track: student.track,
          avatarUrl: student.avatarUrl || null,
          registeredAt: student.createdAt
        },
        lectureAccess: lectureAccess.map((item) => {
          const lecture = lectureById.get(String(item.courseId));
          const course = courseById.get(String(item.courseId));
          return {
            id: item._id,
            lectureTitle: lecture?.title_ar || lecture?.title_en || null,
            courseTitle: course?.title_ar || course?.title_en || null,
            purchasedAt: item.purchasedAt,
            expiresAt: item.expiresAt,
            viewsUsed: item.viewsUsed,
            maxViews: item.maxViews
          };
        }),
        courseEnrollments: enrollments.filter((item) => item.courseId).map((item) => ({
          id: item._id,
          courseTitle: item.courseId.title_ar || item.courseId.title_en || null,
          purchasedAt: item.purchasedAt,
          expiresAt: item.expiresAt,
          source: item.source
        }))
      }
    });
  } catch (err) {
    next(err);
  }
};

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
    const standaloneFilter = { studentId, ...req.tenantFilter };
    await settleExpiredStandaloneExamSubmissions({ filter: standaloneFilter });
    const [quizSubmissions, videoProgress, assignments, standaloneExamSubmissions] = await Promise.all([
      QuizSubmission.find({ studentId, ...req.tenantFilter }).sort({ submittedAt: -1 }).lean(),
      VideoProgress.find({ studentId, ...req.tenantFilter }).lean(),
      Assignment.find({ studentId, ...req.tenantFilter }).sort({ submittedAt: -1 }).lean(),
      StandaloneExamSubmission.find(standaloneFilter).sort({ startedAt: -1 }).lean()
    ]);

    const standaloneExamIds = [...new Set(standaloneExamSubmissions.map((submission) => String(submission.examId)))];
    const standaloneExams = standaloneExamIds.length
      ? await StandaloneExam.find({ _id: { $in: standaloneExamIds }, ...req.tenantFilter }).select('title stage durationMinutes thumbnailUrl').lean()
      : [];
    const standaloneExamById = new Map(standaloneExams.map((exam) => [String(exam._id), exam]));

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
        assignments,
        standaloneExamSubmissions: standaloneExamSubmissions.map((submission) => ({
          ...submission,
          exam: standaloneExamById.get(String(submission.examId)) || null
        }))
      }
    });
  } catch (err) {
    next(err);
  }
};
