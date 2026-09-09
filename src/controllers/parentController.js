const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Course = require('../models/Course');
const Quiz = require('../models/Quiz');
const QuizSubmission = require('../models/QuizSubmission');
const StandaloneExam = require('../models/StandaloneExam');
const StandaloneExamSubmission = require('../models/StandaloneExamSubmission');
const Assignment = require('../models/Assignment');
const LectureProgress = require('../models/LectureProgress');
const { getEnrolledCoursesForStudent } = require('./lectureAccessController');
const { getExamGradesForStudent } = require('./quizController');
const { getAssignmentGradesForStudent } = require('./assignmentController');
const { settleExpiredStandaloneExamSubmissions } = require('../services/standaloneExamSubmissionService');

const RECENT_ITEMS_LIMIT = 20;
const ACTIVITY_LIMIT = 30;
const MAX_ACTIVITY_LIMIT = 100;

async function getParentChild(req) {
  // Deliberately derive the child only from the authenticated parent. These
  // endpoints have no :childId parameter and never trust a query/body id.
  if (!req.user.childId) return null;

  return User.findOne({
    _id: req.user.childId,
    role: 'student',
    ...req.tenantFilter
  }).select('name avatarUrl stage instructorId tenantId').lean();
}

async function getCourseMap(courseIds, tenantFilter) {
  if (!courseIds.length) return new Map();
  const courses = await Course.find({ _id: { $in: courseIds }, isPublished: true, ...tenantFilter })
    .select('title_ar title_en stage')
    .lean();
  return new Map(courses.map((course) => [String(course._id), course]));
}

function courseSummary(course) {
  if (!course) return null;
  return {
    id: course._id,
    title: course.title_ar || course.title_en || '',
    stage: course.stage
  };
}

function quizTitle(quiz, course) {
  if (quiz?.type === 'monthly_exam') return 'اختبار الشهر';
  return course?.title_ar || course?.title_en || 'اختبار محاضرة';
}

// GET /api/v1/parents/me/child
exports.getMyChild = async (req, res, next) => {
  try {
    const child = await getParentChild(req);
    if (!child) return res.status(404).json({ message: 'لم يتم ربط حساب ولي الأمر بطالب' });

    const [instructor, tenant] = await Promise.all([
      User.findOne({ _id: child.instructorId, role: 'admin', ...req.tenantFilter })
        .select('name avatarUrl brandLogo')
        .lean(),
      Tenant.findById(child.tenantId).select('name subdomain logoUrl').lean()
    ]);

    if (!instructor || !tenant) return res.status(404).json({ message: 'بيانات الطالب غير مكتملة' });

    return res.json({
      data: {
        id: child._id,
        name: child.name,
        avatarUrl: child.avatarUrl || null,
        stage: child.stage,
        instructor: {
          id: instructor._id,
          name: instructor.name,
          avatarUrl: instructor.avatarUrl || null,
          brandLogo: instructor.brandLogo || null
        },
        tenant: {
          id: tenant._id,
          name: tenant.name,
          subdomain: tenant.subdomain,
          logoUrl: tenant.logoUrl || null
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/parents/me/child/courses
// The child is always resolved from the authenticated parent's childId.
exports.getMyChildCourses = async (req, res, next) => {
  try {
    const child = await getParentChild(req);
    if (!child) return res.status(404).json({ message: 'لم يتم ربط حساب ولي الأمر بطالب' });

    const enrolled = await getEnrolledCoursesForStudent({ studentId: child._id, tenantFilter: req.tenantFilter });
    return res.json({
      data: enrolled.map((item) => ({
        id: item.course._id,
        title: item.course.title_ar || item.course.title_en || null,
        stage: item.course.stage || null,
        thumbnailUrl: item.course.thumbnailUrl || null,
        lectureCount: item.course.lectureCount || 0,
        fullAccess: item.fullAccess,
        partialLectureCount: item.partialLectureCount || 0,
        expiresAt: item.expiresAt || null
      }))
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/parents/me/child/exam-grades
exports.getMyChildExamGrades = async (req, res, next) => {
  try {
    const child = await getParentChild(req);
    if (!child) return res.status(404).json({ message: 'لم يتم ربط حساب ولي الأمر بطالب' });

    const data = await getExamGradesForStudent({ studentId: child._id, tenantFilter: req.tenantFilter });
    return res.json({ data });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/parents/me/child/assignment-grades
exports.getMyChildAssignmentGrades = async (req, res, next) => {
  try {
    const child = await getParentChild(req);
    if (!child) return res.status(404).json({ message: 'لم يتم ربط حساب ولي الأمر بطالب' });

    const data = await getAssignmentGradesForStudent({ studentId: child._id, tenantFilter: req.tenantFilter });
    return res.json({ data });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/parents/me/child/report
exports.getMyChildReport = async (req, res, next) => {
  try {
    const child = await getParentChild(req);
    if (!child) return res.status(404).json({ message: 'لم يتم ربط حساب ولي الأمر بطالب' });

    const childFilter = { studentId: child._id, ...req.tenantFilter };
    await settleExpiredStandaloneExamSubmissions({ filter: childFilter });
    const [quizSubmissions, standaloneExamSubmissions, assignments, progressRecords, totalCourses] = await Promise.all([
      QuizSubmission.find(childFilter).sort({ submittedAt: -1 }).lean(),
      StandaloneExamSubmission.find(childFilter).sort({ startedAt: -1 }).lean(),
      Assignment.find(childFilter).sort({ submittedAt: -1 }).lean(),
      LectureProgress.find(childFilter).sort({ updatedAt: -1 }).lean(),
      Course.countDocuments({
        instructorId: child.instructorId,
        stage: child.stage,
        isPublished: true,
        ...req.tenantFilter
      })
    ]);

    const quizIds = [...new Set(quizSubmissions.map((item) => String(item.quizId)))];
    const quizzes = quizIds.length
      ? await Quiz.find({ _id: { $in: quizIds }, ...req.tenantFilter }).select('courseId type stage month').lean()
      : [];
    const quizById = new Map(quizzes.map((quiz) => [String(quiz._id), quiz]));
    const standaloneExamIds = [...new Set(standaloneExamSubmissions.map((item) => String(item.examId)))];
    const standaloneExams = standaloneExamIds.length
      ? await StandaloneExam.find({ _id: { $in: standaloneExamIds }, ...req.tenantFilter }).select('title stage durationMinutes thumbnailUrl').lean()
      : [];
    const standaloneExamById = new Map(standaloneExams.map((exam) => [String(exam._id), exam]));
    const courseIds = [...new Set([
      ...assignments.map((item) => String(item.courseId)),
      ...progressRecords.map((item) => String(item.courseId)),
      ...quizzes.filter((quiz) => quiz.courseId).map((quiz) => String(quiz.courseId))
    ])];
    const coursesById = await getCourseMap(courseIds, req.tenantFilter);

    const average = (items, field) => {
      if (!items.length) return null;
      return Number((items.reduce((sum, item) => sum + item[field], 0) / items.length).toFixed(2));
    };
    const gradedAssignments = assignments.filter((assignment) => typeof assignment.grade === 'number');
    const quizAverage = average(quizSubmissions, 'score');
    const standaloneExamAverage = average(standaloneExamSubmissions.filter((item) => typeof item.score === 'number'), 'score');
    const assignmentAverage = average(gradedAssignments, 'grade');
    const gradeValues = [quizAverage, standaloneExamAverage, assignmentAverage].filter((value) => typeof value === 'number');

    return res.json({
      data: {
        child: { id: child._id, name: child.name, avatarUrl: child.avatarUrl || null, stage: child.stage },
        grades: {
          quizAverage,
          standaloneExamAverage,
          assignmentAverage,
          overallAverage: gradeValues.length ? Number((gradeValues.reduce((sum, value) => sum + value, 0) / gradeValues.length).toFixed(2)) : null
        },
        // The current schema has no attendance entity. Report this explicitly
        // rather than deriving fake attendance from unrelated learning events.
        attendance: { tracked: false, attendedSessions: null, totalSessions: null },
        courseProgress: {
          totalCourses,
          startedCourses: progressRecords.length,
          homeworkCompletedCourses: progressRecords.filter((item) => item.homeworkCompleted).length,
          quizPassedCourses: progressRecords.filter((item) => item.quizPassed).length,
          courses: progressRecords.map((item) => ({
            course: courseSummary(coursesById.get(String(item.courseId))),
            homeworkCompleted: item.homeworkCompleted,
            quizPassed: item.quizPassed,
            unlockedAt: item.unlockedAt || null,
            updatedAt: item.updatedAt
          }))
        },
        assignments: {
          total: assignments.length,
          pending: assignments.filter((item) => item.status === 'pending').length,
          graded: assignments.filter((item) => item.status === 'graded').length,
          resubmit: assignments.filter((item) => item.status === 'resubmit').length,
          averageGrade: assignmentAverage,
          recent: assignments.slice(0, RECENT_ITEMS_LIMIT).map((item) => ({
            id: item._id,
            course: courseSummary(coursesById.get(String(item.courseId))),
            status: item.status,
            grade: item.grade,
            feedback: item.feedback || '',
            submittedAt: item.submittedAt
          }))
        },
        quizzes: {
          attempts: quizSubmissions.length,
          passed: quizSubmissions.filter((item) => item.passed).length,
          averageScore: quizAverage,
          recent: quizSubmissions.slice(0, RECENT_ITEMS_LIMIT).map((item) => {
            const quiz = quizById.get(String(item.quizId));
            const relatedCourse = quiz?.courseId ? coursesById.get(String(quiz.courseId)) : null;
            return {
              id: item._id,
              quizId: item.quizId,
              type: quiz?.type || 'lecture',
              title: quizTitle(quiz, relatedCourse),
              course: courseSummary(relatedCourse),
              score: item.score,
              passed: item.passed,
              isRetryAttempt: item.isRetryAttempt,
              submittedAt: item.submittedAt
            };
          })
        },
        standaloneExams: {
          attempts: standaloneExamSubmissions.length,
          autoSubmitted: standaloneExamSubmissions.filter((item) => item.autoSubmitted).length,
          averageScore: standaloneExamAverage,
          recent: standaloneExamSubmissions.slice(0, RECENT_ITEMS_LIMIT).map((item) => ({
            id: item._id,
            examId: item.examId,
            title: standaloneExamById.get(String(item.examId))?.title || 'امتحان مستقل',
            score: item.score,
            startedAt: item.startedAt,
            submittedAt: item.submittedAt,
            autoSubmitted: item.autoSubmitted
          }))
        }
      }
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/parents/me/child/activity?limit=30
exports.getMyChildActivity = async (req, res, next) => {
  try {
    const child = await getParentChild(req);
    if (!child) return res.status(404).json({ message: 'لم يتم ربط حساب ولي الأمر بطالب' });

    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_ACTIVITY_LIMIT)
      : ACTIVITY_LIMIT;
    const childFilter = { studentId: child._id, ...req.tenantFilter };
    const [quizSubmissions, assignments, progressRecords] = await Promise.all([
      QuizSubmission.find(childFilter).sort({ submittedAt: -1 }).limit(limit).lean(),
      Assignment.find(childFilter).sort({ submittedAt: -1 }).limit(limit).lean(),
      LectureProgress.find(childFilter).sort({ updatedAt: -1 }).limit(limit).lean()
    ]);

    const quizIds = [...new Set(quizSubmissions.map((item) => String(item.quizId)))];
    const quizzes = quizIds.length
      ? await Quiz.find({ _id: { $in: quizIds }, ...req.tenantFilter }).select('courseId type').lean()
      : [];
    const quizById = new Map(quizzes.map((quiz) => [String(quiz._id), quiz]));
    const courseIds = [...new Set([
      ...assignments.map((item) => String(item.courseId)),
      ...progressRecords.map((item) => String(item.courseId)),
      ...quizzes.filter((quiz) => quiz.courseId).map((quiz) => String(quiz.courseId))
    ])];
    const coursesById = await getCourseMap(courseIds, req.tenantFilter);

    const items = [
      ...quizSubmissions.map((item) => {
        const quiz = quizById.get(String(item.quizId));
        const relatedCourse = quiz?.courseId ? coursesById.get(String(quiz.courseId)) : null;
        return {
          id: `quiz:${item._id}`,
          type: 'quiz_submission',
          occurredAt: item.submittedAt,
          title: quizTitle(quiz, relatedCourse),
          course: courseSummary(relatedCourse),
          score: item.score,
          passed: item.passed
        };
      }),
      ...assignments.map((item) => ({
        id: `assignment:${item._id}`,
        type: 'assignment_submission',
        occurredAt: item.submittedAt,
        title: 'تم تسليم واجب',
        course: courseSummary(coursesById.get(String(item.courseId))),
        status: item.status,
        grade: item.grade
      })),
      ...progressRecords.map((item) => ({
        id: `progress:${item._id}`,
        type: 'course_progress',
        occurredAt: item.updatedAt,
        title: item.quizPassed ? 'تم اجتياز اختبار المحاضرة' : item.homeworkCompleted ? 'تم إكمال واجب المحاضرة' : 'تم تحديث تقدم المحاضرة',
        course: courseSummary(coursesById.get(String(item.courseId))),
        homeworkCompleted: item.homeworkCompleted,
        quizPassed: item.quizPassed
      }))
    ]
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
      .slice(0, limit);

    return res.json({
      data: {
        child: { id: child._id, name: child.name, avatarUrl: child.avatarUrl || null, stage: child.stage },
        items,
        limit
      }
    });
  } catch (err) {
    next(err);
  }
};
