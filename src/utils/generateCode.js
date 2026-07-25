const crypto = require('crypto');

// Cryptographically random codes — deliberately crypto.randomBytes, NOT
// Math.random(). Math.random() is not cryptographically secure (it's
// seedable/predictable given enough samples), and these codes function
// exactly like bearer tokens for real money (scratch cards) or paid
// content access (access codes). A predictable code generator would let an
// attacker guess valid codes.
function generateSingleCode() {
  // 5 bytes -> 10 hex chars, uppercased, dash-split for readability
  // (e.g. "A1B2C-D3E4F"). Adjust length/format as needed, but keep the
  // underlying entropy source as crypto.randomBytes.
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function hashCode(plaintext) {
  // SHA-256 is sufficient here (not bcrypt) — these are high-entropy random
  // tokens, not low-entropy human-chosen passwords, so there's no
  // brute-force-by-guessing-common-values risk that bcrypt's deliberate
  // slowness defends against. A fast, deterministic hash also lets redeem
  // lookups use a direct indexed equality match on code_hash instead of
  // bcrypt.compare() against every stored hash.
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

// Generates `count` codes. Returns BOTH the plaintext codes (shown to the
// teacher ONCE, in the generate response, and never persisted anywhere —
// not in this function, not in the controller, not in any log) and their
// hashes (what actually gets written to the DB).
//
// WHY plaintext is never stored: if the database is ever breached, stored
// plaintext codes would be directly usable by an attacker to redeem wallet
// credit or course access — exactly like a leaked password database. By
// only ever persisting the hash, a DB breach alone is not enough to redeem
// any code; the attacker would still need the original plaintext, which
// only ever existed transiently in the generate-response payload.
function generateBatch(count) {
  const plaintextCodes = [];
  const hashedCodes = [];

  for (let i = 0; i < count; i++) {
    const code = generateSingleCode();
    plaintextCodes.push(code);
    hashedCodes.push(hashCode(code));
  }

  return { plaintextCodes, hashedCodes };
}

module.exports = { generateBatch, hashCode };