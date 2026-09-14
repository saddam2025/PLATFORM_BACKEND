const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const Tenant = require('../models/Tenant');

const FEATURED_LIMIT = 9;

async function getActiveTenants() {
  return Tenant.find({ isActive: true, deletedAt: null })
    .select('_id name subdomain logoUrl')
    .lean();
}

function tenantDetailsById(tenants) {
  return new Map(tenants.map((tenant) => [String(tenant._id), tenant]));
}

function publicInstructor(tenant) {
  return { name: tenant.name, subdomain: tenant.subdomain, avatar: tenant.logoUrl || null };
}

async function attachPublishedContentCounts(courses) {
  if (!courses.length) return courses;
  const counts = await Lecture.aggregate([
    { $match: { courseId: { $in: courses.map((course) => course._id) }, isPublished: true } },
    { $group: { _id: '$courseId', lectureCount: { $sum: 1 }, homeworkCount: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$homeworkUrl', ''] }, ''] }, 1, 0] } } } }
  ]);
  const byCourse = new Map(counts.map((count) => [String(count._id), count]));
  return courses.map((course) => ({ ...course, lectureCount: byCourse.get(String(course._id))?.lectureCount || 0, homeworkCount: byCourse.get(String(course._id))?.homeworkCount || 0 }));
}

// GET /api/v1/public/featured-courses
// This is the one intentional cross-tenant content query: the root landing
// page is a public discovery feed, not a request scoped to one tenant.
exports.listFeaturedCourses = async (req, res, next) => {
  try {
    const tenants = await getActiveTenants();
    if (!tenants.length) return res.json({ data: [] });

    const tenantById = tenantDetailsById(tenants);
    const courses = await Course.find({
      tenantId: { $in: tenants.map((tenant) => tenant._id) },
      isPublished: true
    })
      .select('_id tenantId title_ar title_en description_ar description_en price stage thumbnailUrl updatedAt')
      .sort({ updatedAt: -1, _id: -1 })
      .limit(FEATURED_LIMIT)
      .lean();

    const coursesWithCounts = await attachPublishedContentCounts(courses);
    res.json({ data: coursesWithCounts.map((course) => {
      const tenant = tenantById.get(String(course.tenantId));
      return { ...course, instructor: publicInstructor(tenant), instructorName: tenant.name, subdomain: tenant.subdomain };
    }) });
  } catch (err) {
    next(err);
  }
};

// GET /api/v1/public/featured-lectures
// This is the same intentional public cross-tenant exception. Both the
// lecture and its parent course must be published, and its tenant must still
// be active and not soft-deleted before it can be returned.
exports.listFeaturedLectures = async (req, res, next) => {
  try {
    const tenants = await getActiveTenants();
    if (!tenants.length) return res.json({ data: [] });

    const tenantIds = tenants.map((tenant) => tenant._id);
    const tenantById = tenantDetailsById(tenants);
    const courses = await Course.find({ tenantId: { $in: tenantIds }, isPublished: true })
      .select('_id tenantId title_ar title_en')
      .lean();
    if (!courses.length) return res.json({ data: [] });

    const courseById = new Map(courses.map((course) => [String(course._id), course]));
    const lectures = await Lecture.find({
      tenantId: { $in: tenantIds },
      courseId: { $in: courses.map((course) => course._id) },
      isPublished: true
    })
      .select('_id tenantId courseId title_ar title_en description_ar description_en price order thumbnailUrl updatedAt')
      .sort({ updatedAt: -1, _id: -1 })
      .limit(FEATURED_LIMIT)
      .lean();

    res.json({ data: lectures.filter((lecture) => {
      const course = courseById.get(String(lecture.courseId));
      return course && String(course.tenantId) === String(lecture.tenantId);
    }).map((lecture) => {
      const course = courseById.get(String(lecture.courseId));
      const tenant = tenantById.get(String(lecture.tenantId));
      return {
        ...lecture,
        courseTitle: course?.title_ar || course?.title_en || '',
        instructor: publicInstructor(tenant),
        instructorName: tenant.name,
        subdomain: tenant.subdomain
      };
    }) });
  } catch (err) {
    next(err);
  }
};
