const mongoose = require('mongoose');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');
const LectureProgress = require('../models/LectureProgress');
const LectureAccess = require('../models/LectureAccess');
const CourseEnrollment = require('../models/CourseEnrollment');
const Quiz = require('../models/Quiz');
const { getLectureAccessState } = require('./lectureAccessController');

function ownsInstructor(user, instructorId) {
  return (user.role === 'admin' && String(user._id) === String(instructorId))
    || (user.role === 'assistant' && String(user.instructorId) === String(instructorId));
}

exports.createLecture = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;
    if (!ownsInstructor(req.user, instructorId)) return res.status(403).json({ message: 'غير مصرح لك بإدارة محاضرات هذا الكورس' });
    const course = await Course.findOne({ _id: courseId, instructorId, ...req.tenantFilter });
    if (!course) return res.status(404).json({ message: 'الكورس غير موجود' });
    if (typeof req.body.title_ar !== 'string' || !req.body.title_ar.trim()) return res.status(400).json({ message: 'عنوان المحاضرة بالعربية مطلوب' });
    const lastLecture = await Lecture.findOne({ courseId, ...req.tenantFilter }).sort({ order: -1 }).select('order').lean();
    const nextOrder = Number(lastLecture?.order || 0) + 1;
    const lecture = await Lecture.create({
      tenantId: req.user.tenantId, courseId, instructorId,
      title_ar: req.body.title_ar, title_en: req.body.title_en || '',
      description_ar: req.body.description_ar || '', description_en: req.body.description_en || '',
      // New lectures append safely. Reordering is handled by the dedicated,
      // atomic reorder endpoint after creation.
      order: nextOrder,
      price: Number(req.body.price) || 0,
      thumbnailUrl: req.files?.thumbnail?.[0] ? `/uploads/thumbnails/${req.files.thumbnail[0].filename}` : null,
      videoUrl: req.files?.video?.[0] ? `/uploads/videos/${req.files.video[0].filename}` : null,
      homeworkUrl: req.files?.homework?.[0] ? `/uploads/homework/${req.files.homework[0].filename}` : null,
      accessPeriodDays: Number(req.body.accessPeriodDays) || 10,
      maxViews: Number(req.body.maxViews) || 10,
      isPublished: req.body.isPublished === true || req.body.isPublished === 'true'
    });
    res.status(201).json({ data: lecture });
  } catch (err) { if (err.code === 11000) return res.status(409).json({ message: 'ترتيب المحاضرة مستخدم بالفعل؛ غيّره أو أعد المحاولة' }); next(err); }
};

function lectureFields(req) {
  const fields = {};
  for (const key of ['title_ar', 'title_en', 'description_ar', 'description_en']) if (req.body[key] !== undefined) fields[key] = req.body[key];
  for (const key of ['order', 'price', 'accessPeriodDays', 'maxViews']) if (req.body[key] !== undefined) fields[key] = Number(req.body[key]);
  if (req.body.quizId !== undefined) fields.quizId = req.body.quizId || null;
  if (req.body.isPublished !== undefined) fields.isPublished = req.body.isPublished === true || req.body.isPublished === 'true';
  if (req.files?.thumbnail?.[0]) fields.thumbnailUrl = `/uploads/thumbnails/${req.files.thumbnail[0].filename}`;
  if (req.files?.video?.[0]) fields.videoUrl = `/uploads/videos/${req.files.video[0].filename}`;
  if (req.files?.homework?.[0]) fields.homeworkUrl = `/uploads/homework/${req.files.homework[0].filename}`;
  return fields;
}

async function getOwnedLecture(req) {
  const { instructorId, courseId, lectureId } = req.params;
  if (!ownsInstructor(req.user, instructorId)) return false;
  return Lecture.findOne({ _id: lectureId, courseId, instructorId, ...req.tenantFilter });
}

exports.listLecturesForEditing = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;
    if (!ownsInstructor(req.user, instructorId)) return res.status(403).json({ message: 'غير مصرح لك بإدارة محاضرات هذا الكورس' });
    const course = await Course.findOne({ _id: courseId, instructorId, ...req.tenantFilter });
    if (!course) return res.status(404).json({ message: 'الكورس غير موجود' });
    res.json({ data: await Lecture.find({ courseId, instructorId, ...req.tenantFilter }).sort({ order: 1 }).lean() });
  } catch (err) { next(err); }
};

exports.updateLecture = async (req, res, next) => {
  try {
    const lecture = await getOwnedLecture(req);
    if (lecture === false) return res.status(403).json({ message: 'غير مصرح لك بإدارة محاضرات هذا الكورس' });
    if (!lecture) return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    Object.assign(lecture, lectureFields(req)); await lecture.save();
    if (lecture.quizId) await Quiz.updateOne({ _id: lecture.quizId, ...req.tenantFilter }, { $set: { courseId: lecture.courseId, lectureId: lecture._id, type: 'lecture', instructorId: lecture.instructorId } });
    res.json({ data: lecture });
  } catch (err) { next(err); }
};

exports.reorderLectures = async (req, res, next) => {
  try {
    const { instructorId, courseId } = req.params;
    if (!ownsInstructor(req.user, instructorId)) return res.status(403).json({ message: 'غير مصرح لك بإدارة محاضرات هذا الكورس' });
    const ids = Array.isArray(req.body?.lectureIds) ? req.body.lectureIds : [];
    const lectures = await Lecture.find({ courseId, instructorId, ...req.tenantFilter }).select('_id');
    if (ids.length !== lectures.length || new Set(ids.map(String)).size !== ids.length || !lectures.every((item) => ids.some((id) => String(id) === String(item._id)))) return res.status(400).json({ message: 'ترتيب المحاضرات غير صالح' });
    await Promise.all(ids.map((id, index) => Lecture.updateOne({ _id: id, courseId, instructorId, ...req.tenantFilter }, { $set: { order: index + 1 } })));
    res.json({ data: await Lecture.find({ courseId, instructorId, ...req.tenantFilter }).sort({ order: 1 }) });
  } catch (err) { next(err); }
};

exports.deleteLecture = async (req, res, next) => {
  try {
    const lecture = await getOwnedLecture(req);
    if (lecture === false) return res.status(403).json({ message: 'غير مصرح لك بإدارة محاضرات هذا الكورس' });
    if (!lecture) return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    await Lecture.deleteOne({ _id: lecture._id, ...req.tenantFilter });
    const remaining = await Lecture.find({ courseId: lecture.courseId, instructorId: lecture.instructorId, ...req.tenantFilter }).sort({ order: 1 });
    await Promise.all(remaining.map((item, index) => Lecture.updateOne({ _id: item._id, ...req.tenantFilter }, { $set: { order: index + 1 } })));
    res.json({ data: { id: lecture._id } });
  } catch (err) { next(err); }
};

exports.listCourseLectures = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.isValidObjectId(courseId)) return res.status(400).json({ message: 'معرف الكورس غير صالح' });
    // This is the public course-detail feed. Resolve the tenant from the
    // published course so visitors do not need a session, while a signed-in
    // tenant user cannot query a course belonging to another tenant.
    const courseFilter = { _id: courseId, isPublished: true };
    if (req.user?.role !== 'super_admin' && req.user?.tenantId) courseFilter.tenantId = req.user.tenantId;
    const course = await Course.findOne(courseFilter).select('_id tenantId').lean();
    if (!course) return res.status(404).json({ message: 'الكورس غير موجود' });

    // Published-only is deliberately retained for every caller. Editing
    // drafts remains on the ownership-protected instructor endpoint.
    const tenantFilter = { tenantId: course.tenantId };
    const lectures = await Lecture.find({ courseId, isPublished: true, ...tenantFilter }).sort({ order: 1 }).lean();
    if (req.user?.role !== 'student') return res.json({ data: lectures });
    const states = await Promise.all(lectures.map((lecture) => getLectureAccessState({ studentId: req.user._id, tenantFilter, courseId, lectureId: lecture._id })));
    const data = states.map((state) => ({ ...state.lecture, locked: !state.accessible, status: state.status, canPurchase: state.status === 'not_purchased', includedWithCourse: state.includedWithCourse }));
    res.json({ data });
  } catch (err) { next(err); }
};
