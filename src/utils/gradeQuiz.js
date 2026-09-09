// Pure grading function shared by both regular quiz submission and monthly
// exam submission — no duplicated grading logic anywhere else in the app.
function gradeSubmission(quiz, answers) {
  const questions = quiz.questions || [];
  const incorrectQuestionIndexes = [];
  let earnedPoints = 0;
  const totalPoints = questions.reduce((sum, question) => sum + (Number(question.points) || 1), 0);

  questions.forEach((q, idx) => {
    if (answers[idx] === q.correctOptionIndex) {
      earnedPoints += Number(q.points) || 1;
    } else {
      incorrectQuestionIndexes.push(idx);
    }
  });

  // Existing quizzes default every question to one point, preserving their
  // prior percentage calculation; standalone exams can use weighted points.
  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const passingScore = typeof quiz.passingScore === 'number' ? quiz.passingScore : 50;
  const passed = score >= passingScore;

  return { score, passed, incorrectQuestionIndexes };
}

module.exports = gradeSubmission;
