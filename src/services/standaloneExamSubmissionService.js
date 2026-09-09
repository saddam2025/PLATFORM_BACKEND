const StandaloneExam = require('../models/StandaloneExam');
const StandaloneExamSubmission = require('../models/StandaloneExamSubmission');
const gradeSubmission = require('../utils/gradeQuiz');

function expiresAtFor(exam, startedAt) {
  return new Date(new Date(startedAt).getTime() + exam.durationMinutes * 60 * 1000);
}

// Answers are deliberately stored only on final submission. Therefore an
// abandoned attempt has no answers to preserve and receives a zero score.
async function settleExpiredSubmission(submission, exam, now = new Date()) {
  if (!submission || submission.submittedAt || !exam) return submission;
  const expiresAt = expiresAtFor(exam, submission.startedAt);
  if (now < expiresAt) return submission;

  const { score } = gradeSubmission(exam, submission.answers || []);
  const updated = await StandaloneExamSubmission.findOneAndUpdate(
    { _id: submission._id, submittedAt: null },
    { $set: { score, submittedAt: expiresAt, autoSubmitted: true } },
    { new: true }
  );
  return updated || submission;
}

// Lazy expiry is invoked by every score/read surface. It updates the existing
// one-attempt document, never creates another submission.
async function settleExpiredStandaloneExamSubmissions({ filter, now = new Date() }) {
  const pending = await StandaloneExamSubmission.find({ ...filter, submittedAt: null });
  if (!pending.length) return [];

  const examIds = [...new Set(pending.map((submission) => String(submission.examId)))];
  const exams = await StandaloneExam.find({ _id: { $in: examIds }, tenantId: filter.tenantId }).lean();
  const examsById = new Map(exams.map((exam) => [String(exam._id), exam]));
  return Promise.all(pending.map((submission) => settleExpiredSubmission(submission, examsById.get(String(submission.examId)), now)));
}

module.exports = { expiresAtFor, settleExpiredSubmission, settleExpiredStandaloneExamSubmissions };
