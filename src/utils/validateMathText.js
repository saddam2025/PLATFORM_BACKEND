const MAX_LATEX_SEGMENT_LENGTH = 500;
const MATH_SEGMENT_PATTERN = /\$([^$\r\n]*)\$/g;

// Question fields remain ordinary strings. This only bounds every embedded
// LaTeX segment so deeply nested payloads cannot make rendering unbounded.
function hasSafeMathSegments(value) {
  MATH_SEGMENT_PATTERN.lastIndex = 0;
  let segment;
  while ((segment = MATH_SEGMENT_PATTERN.exec(value)) !== null) {
    if (segment[1].length > MAX_LATEX_SEGMENT_LENGTH) return false;
  }
  return true;
}

module.exports = { MAX_LATEX_SEGMENT_LENGTH, hasSafeMathSegments };
