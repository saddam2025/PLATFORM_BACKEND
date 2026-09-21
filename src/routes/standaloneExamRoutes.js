const express = require('express');
const { protect, authorize } = require('../middlewares/authMiddleware');
const tenantScope = require('../middlewares/tenantScope.middleware');
const { uploadGeneral, uploadQuestionStemImage } = require('../middlewares/uploadMiddleware');
const { uploadQuestionImage } = require('../controllers/questionImageController');
const {
  createStandaloneExam,
  listManagedStandaloneExams,
  updateStandaloneExam,
  publishStandaloneExam,
  closeStandaloneExam,
  deleteStandaloneExam,
  listAvailableStandaloneExams,
  startStandaloneExam,
  submitStandaloneExam,
  listMyStandaloneExamScores
} = require('../controllers/standaloneExamController');

const router = express.Router();
const examThumbnailUpload = uploadGeneral.fields([{ name: 'thumbnail', maxCount: 1 }]);
const questionImageUpload = uploadQuestionStemImage;

router.post('/instructors/:instructorId/exams/question-image', protect, tenantScope, authorize('admin', 'assistant'), questionImageUpload, uploadQuestionImage);
router.post('/instructors/:instructorId/exams', protect, tenantScope, authorize('admin', 'assistant'), examThumbnailUpload, createStandaloneExam);
router.get('/instructors/:instructorId/exams', protect, tenantScope, authorize('admin', 'assistant'), listManagedStandaloneExams);
router.patch('/instructors/:instructorId/exams/:examId', protect, tenantScope, authorize('admin', 'assistant'), examThumbnailUpload, updateStandaloneExam);
router.patch('/instructors/:instructorId/exams/:examId/publish', protect, tenantScope, authorize('admin', 'assistant'), publishStandaloneExam);
router.patch('/instructors/:instructorId/exams/:examId/close', protect, tenantScope, authorize('admin', 'assistant'), closeStandaloneExam);
router.delete('/instructors/:instructorId/exams/:examId', protect, tenantScope, authorize('admin', 'assistant'), deleteStandaloneExam);
router.get('/exams/available', protect, tenantScope, authorize('student'), listAvailableStandaloneExams);
router.post('/exams/:examId/start', protect, tenantScope, authorize('student'), startStandaloneExam);
router.post('/exams/:examId/submit', protect, tenantScope, authorize('student'), submitStandaloneExam);
router.get('/students/me/exam-scores', protect, tenantScope, authorize('student'), listMyStandaloneExamScores);

module.exports = router;
