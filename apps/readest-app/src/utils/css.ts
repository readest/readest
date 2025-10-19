import postcss from 'postcss';

const cssValidate = (css: string) => {
  if (!css || !css.trim()) {
    return { isValid: false, error: 'Empty CSS' };
  }

  try {
    postcss.parse(css);

    return { isValid: true, error: null };
  } catch (e) {
    // e.g., "Unclosed block", "Unknown word", "Missed semicolon"
    return { isValid: false, error: e.reason || e.message };
  }
};

export default cssValidate;
