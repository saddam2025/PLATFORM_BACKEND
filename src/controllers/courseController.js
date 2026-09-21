const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const Category = require('../models/Category');
const User = require('../models/User');
const LectureProgress = require('../models/LectureProgress');
const LectureAccess = require('../models/LectureAccess');
const CourseEnrollment = require('../models/CourseEnrollment');
const Lecture = require('../models/Lecture');
const createNotificationsForAudience = require('../utils/createNotification'); // NEW import for this batch
const { uploadImageFile } = require('../utils/r2Upload');

async function getOptionalUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-passwordHash');
    return user || null;
  } catch {
    return null;
  }
}

async function resolveInstructorTenant(instructorId) {
  const instructor = mongoose.isValidObjectId(instructorId)
    ? await User.findOne({ _id: instructorId, role: 'admin' }).select('_id tenantId').lean()
    : null;
  if (instructor) return { tenantId: instructor.tenantId, instructorId: instructor._id };

  // Public tenant pages use subdomains in their URLs. Resolve that identifier
  // internally so public tenant responses never disclose ownerId.
  const Tenant = require('../models/Tenant');
  const tenant = await Tenant.findOne({ subdomain: instructorId, isActive: true, deletedAt: null }).select('ownerId').lean();
  return tenant?.ownerId ? { tenantId: tenant._id, instructorId: tenant.ownerId } : null;
}

function isOwnerOfInstructor(user, instructorId) {
  if (!user) return false;
  if (user.role === 'admin') return String(user._id) === String(instructorId);
  if (user.role === 'assistant') return String(user.instructorId) === String(instructorId);
  return false;
}

exports.createCourse = async (req, res, next) => {
  try {
    const { instructorId } = req.params;

    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بإضافة دورات لهذا الحساب' });
    }

    const {
      title_en,
      title_ar,
      description_en,
      description_ar,
      price,
      stage,
      category,
      accessPeriodDays,
      maxViews,
      isPublished,
      externalVideoUrl,
      externalHomeworkUrl
    } = req.body;

    let questions = req.body.questions;
    if (typeof questions === 'string') {
      try {
        questions = JSON.parse(questions);
      } catch {
        questions = [];
      }
    }
    if (!Array.isArray(questions)) questions = [];

    if (!title_ar || !stage || !category) {
      return res.status(400).json({ message: 'العنوان والمرحلة والتصنيف مطلوبة' });
    }

    let categoryDoc = await Category.findOne({ name: category, instructorId, stage, ...req.tenantFilter });
    if (!categoryDoc) {
      categoryDoc = await Category.create({ tenantId: req.user.tenantId, name: category, instructorId, stage });
    }

    const existingCount = await Course.countDocuments({ instructorId, stage, categoryId: categoryDoc._id, ...req.tenantFilter });
    const order = existingCount + 1;

    const thumbnailUrl = req.files?.thumbnail?.[0]
      ? await uploadImageFile(req.files.thumbnail[0], 'thumbnails', 'Course thumbnail')
      : null;
    // A Course is a container, never a watchable lecture. New course-level
    // video/homework inputs are deliberately ignored; those belong to Lecture.
    const videoUrl = null;
    const homeworkUrl = null;

    const isPublishedBool = isPublished === 'true' || isPublished === true;

    const course = await Course.create({
      tenantId: req.user.tenantId,
      title_en,
      title_ar,
      description_en,
      description_ar,
      price: Number(price) || 0,
      stage,
      categoryId: categoryDoc._id,
      order,
      thumbnailUrl,
      videoUrl,
      homeworkUrl,
      instructorId,
      isPublished: isPublishedBool,
      accessPeriodDays: Number(accessPeriodDays) || 10,
      maxViews: Number(maxViews) || 10
    });

    // Course-level quiz data is legacy and intentionally not created. Quiz
    // IDs are attached to individual Lecture records instead.

    // CROSS-BATCH WIRE-UP (added in this batch): feature #13 requires both
    // students AND parents to receive an in-platform notification whenever
    // a new course is PUBLISHED. Only fires when isPublished is explicitly
    // true at creation time — a draft/unpublished course does not notify
    // anyone, since it isn't visible to students yet anyway.
    if (isPublishedBool) {
      await createNotificationsForAudience({
        tenantId: req.user.tenantId,
        instructorId,
        type: 'new_course',
        title: 'دورة جديدة',
        body: `تم نشر دورة جديدة: ${title_ar}`,
        relatedId: course._id,
        audience: 'both'
      });
    }

    res.status(201).json({ data: course });
  } catch (err) {
    next(err);
  }
};

exports.listCourses = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { stage, category } = req.query;

    const requester = await getOptionalUser(req);
    const isOwner = isOwnerOfInstructor(requester, instructorId);
    const instructor = await resolveInstructorTenant(instructorId);
    if (!instructor?.tenantId) return res.status(404).json({ message: 'المدرس غير موجود' });

    const resolvedInstructorId = instructor.instructorId;
    const filter = { instructorId: resolvedInstructorId, tenantId: instructor.tenantId };
    if (stage) filter.stage = stage;
    if (!isOwner) filter.isPublished = true;

    if (category) {
      // The unscoped catalog (`/:instructorId/catalog`) supplies a category
      // without a stage. Passing `stage: undefined` made this lookup miss
      // every stage-scoped Category, after which `categoryId: null` forced an
      // empty course result. Add the stage constraint only for a stage-scoped
      // catalog request. In the unscoped case, category names can exist at
      // multiple stages, so retain every matching category ID.
      const categoryFilter = { name: category, instructorId: resolvedInstructorId, tenantId: instructor.tenantId };
      if (stage) categoryFilter.stage = stage;
      const categoryDocs = await Category.find(categoryFilter).select('_id').lean();
      filter.categoryId = categoryDocs.length ? { $in: categoryDocs.map((categoryDoc) => categoryDoc._id) } : null;
    }

    let courses = await Course.find(filter).sort({ order: 1 }).populate('categoryId', 'name');
    const courseIds = courses.map((course) => course._id);
    // Live counts intentionally match the published lectures visible to
    // visitors on the course-detail page, avoiding stale Course counters.
    const [lectures, contentCounts] = await Promise.all([
      Lecture.find({ courseId: { $in: courseIds }, isPublished: true, tenantId: instructor.tenantId }).select('_id courseId').lean(),
      courseIds.length ? Lecture.aggregate([
        { $match: { courseId: { $in: courseIds }, isPublished: true, tenantId: instructor.tenantId } },
        { $group: {
          _id: '$courseId',
          lectureCount: { $sum: 1 },
          homeworkCount: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$homeworkUrl', ''] }, ''] }, 1, 0] } }
        } }
      ]) : []
    ]);
    const contentCountByCourse = new Map(contentCounts.map((row) => [String(row._id), row]));

    if (requester?.role === 'student') {
      const now = new Date();
      const [enrollments, accessRows] = await Promise.all([
        CourseEnrollment.find({ studentId: requester._id, tenantId: instructor.tenantId, expiresAt: { $gt: now } }).select('courseId').lean(),
        LectureAccess.find({ studentId: requester._id, tenantId: instructor.tenantId, expiresAt: { $gt: now } }).select('courseId').lean()
      ]);
      // Keep ownership metadata separate from catalog visibility. A student's
      // active enrollment must not hide a course from the complete catalog.
      const fullyOwnedCourseIds = new Set(enrollments.map((row) => String(row.courseId)));
      const accessIds = new Set(accessRows.map((row) => String(row.courseId)));
      const partialLectureCountByCourse = new Map();
      for (const course of courses) {
        const courseId = String(course._id);
        if (accessIds.has(courseId)) { fullyOwnedCourseIds.add(courseId); continue; } // old-style full-course access
        const courseLectures = lectures.filter((lecture) => String(lecture.courseId) === courseId);
        const ownedLectureCount = courseLectures.filter((lecture) => accessIds.has(String(lecture._id))).length;
        if (ownedLectureCount) partialLectureCountByCourse.set(courseId, ownedLectureCount);
      }
      courses = courses.map((course) => ({
          ...course.toObject(),
          owned: fullyOwnedCourseIds.has(String(course._id)),
          partialLectureCount: partialLectureCountByCourse.get(String(course._id)) || 0,
          hasPartialLectureAccess: partialLectureCountByCourse.has(String(course._id))
        }));
    }
    res.json({ data: courses.map((course) => {
      const contentCount = contentCountByCourse.get(String(course._id));
      return { ...(course.toObject ? course.toObject() : course), lectureCount: contentCount?.lectureCount || 0, homeworkCount: contentCount?.homeworkCount || 0 };
    }) });
  } catch (err) {
    next(err);
  }
};

exports.getCourse = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;

    const requester = await getOptionalUser(req);
    const isOwner = isOwnerOfInstructor(requester, instructorId);
    const instructor = await resolveInstructorTenant(instructorId);
    if (!instructor?.tenantId) return res.status(404).json({ message: 'المدرس غير موجود' });

    const resolvedInstructorId = instructor.instructorId;
    const course = await Course.findOne({ _id: courseId, instructorId: resolvedInstructorId, tenantId: instructor.tenantId }).populate('categoryId', 'name');
    if (!course) {
      return res.status(404).json({ message: 'الدورة غير موجودة' });
    }

    if (!course.isPublished && !isOwner) {
      return res.status(404).json({ message: 'الدورة غير موجودة' });
    }

    const responseData = course.toObject();

    res.json({ data: responseData });
  } catch (err) {
    next(err);
  }
};

exports.updateCourse = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;

    if (!isOwnerOfInstructor(req.user, instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل دورات هذا الحساب' });
    }

    const course = await Course.findOne({ _id: courseId, instructorId, ...req.tenantFilter });
    if (!course) {
      return res.status(404).json({ message: 'الدورة غير موجودة' });
    }

    const wasPublished = course.isPublished;

    const updatableFields = [
      'title_en',
      'title_ar',
      'description_en',
      'description_ar',
      'price',
      'stage',
      'order',
      'accessPeriodDays',
      'maxViews',
      'isPublished'
    ];

    updatableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        course[field] = req.body[field];
      }
    });

    if (req.body.category) {
      let categoryDoc = await Category.findOne({
        name: req.body.category,
        instructorId,
        stage: req.body.stage || course.stage,
        ...req.tenantFilter
      });
      if (!categoryDoc) {
        categoryDoc = await Category.create({
          tenantId: req.user.tenantId,
          name: req.body.category,
          instructorId,
          stage: req.body.stage || course.stage
        });
      }
      course.categoryId = categoryDoc._id;
    }

    if (req.files?.thumbnail?.[0]) {
      course.thumbnailUrl = await uploadImageFile(req.files.thumbnail[0], 'thumbnails', 'Course thumbnail');
    }
    // A Course is metadata only. Video, homework, and quizzes are stored on
    // individual Lecture documents and are never updated through this route.

    await course.save();

    // Also notify on the PATCH path if a course transitions from unpublished
    // to published via an edit (not just at creation time) — otherwise a
    // course saved as a draft first and published later would never trigger
    // feature #13's notification.
    if (!wasPublished && course.isPublished) {
      await createNotificationsForAudience({
        tenantId: req.user.tenantId,
        instructorId,
        type: 'new_course',
        title: 'دورة جديدة',
        body: `تم نشر دورة جديدة: ${course.title_ar}`,
        relatedId: course._id,
        audience: 'both'
      });
    }

    res.json({ data: course });
  } catch (err) {
    next(err);
  }
};

exports.deleteCourse = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;

    if (String(req.user._id) !== String(instructorId)) {
      return res.status(403).json({ message: 'غير مصرح لك بحذف دورات هذا الحساب' });
    }

    const course = await Course.findOneAndDelete({ _id: courseId, instructorId, ...req.tenantFilter });
    if (!course) {
      return res.status(404).json({ message: 'الدورة غير موجودة' });
    }

    res.json({ message: 'تم حذف الدورة بنجاح' });
  } catch (err) {
    next(err);
  }
};

exports.listCategories = async (req, res, next) => {
  try {
    const { instructorId } = req.params;
    const { stage } = req.query;

    const instructor = await resolveInstructorTenant(instructorId);
    if (!instructor?.tenantId) return res.status(404).json({ message: 'المدرس غير موجود' });
    const filter = { instructorId, tenantId: instructor.tenantId };
    if (stage) filter.stage = stage;

    const categories = await Category.find(filter);
    res.json({ data: categories });
  } catch (err) {
    next(err);
  }
};
