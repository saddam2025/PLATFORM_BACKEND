const PASSWORD_POLICY_MESSAGE = 'كلمة المرور يجب أن تكون 12 حرفًا على الأقل وتحتوي على حروف وأرقام';

function hasValidPassword(value) {
  return typeof value === 'string'
    && value.length >= 12
    && /[A-Za-z\u0621-\u064A]/.test(value)
    && /[0-9\u0660-\u0669]/.test(value);
}

module.exports = { PASSWORD_POLICY_MESSAGE, hasValidPassword };
