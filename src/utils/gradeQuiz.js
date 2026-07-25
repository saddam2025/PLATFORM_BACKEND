// Pure grading function shared by both regular quiz submission and monthly
// exam submission — no duplicated grading logic anywhere else in the app.
function gradeSubmission(quiz, answers) {
  const questions = quiz.questions || [];
  const incorrectQuestionIndexes = [];
  let correctCount = 0;

  questions.forEach((q, idx) => {
    if (answers[idx] === q.correctOptionIndex) {
      correctCount += 1;
    } else {
      incorrectQuestionIndexes.push(idx);
    }
  });

  const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  const passingScore = typeof quiz.passingScore === 'number' ? quiz.passingScore : 50;
  const passed = score >= passingScore;

  return { score, passed, incorrectQuestionIndexes };
}

module.exports = gradeSubmission;