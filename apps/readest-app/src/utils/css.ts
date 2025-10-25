export const validateCSS = (css: string): { isValid: boolean; error: string | null } => {
  // Remove comments and normalize whitespace
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();

  // CSS property pattern (validate both property name and value)
  const propertyPattern = /^[\s\n]*[-\w]+\s*:\s*[^;]+;?$/;

  // Check if empty
  if (!css) return { isValid: false, error: 'Empty CSS' };

  // Ensure balanced curly braces
  const openBraces = (css.match(/{/g) || []).length;
  const closeBraces = (css.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    return { isValid: false, error: 'Unbalanced curly braces' };
  }

  const atRulePattern = /@[\w-]+[^{]*\{/g;
  let result: RegExpExecArray | null;
  let processedCss = '';
  let lastIndex = 0;

  while ((result = atRulePattern.exec(css)) !== null) {
    const start = result.index;
    const head = css.slice(lastIndex, start).trim();
    if (head) processedCss += head + '\n';

    let i = atRulePattern.lastIndex;
    let depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) return { isValid: false, error: 'Unbalanced curly braces in at-rule' };
    const inner = css.slice(atRulePattern.lastIndex, i - 1).trim();
    const innerResult = validateCSS(inner);
    if (!innerResult.isValid) return innerResult;
    lastIndex = i;
  }

  processedCss += css.slice(lastIndex).trim();
  css = processedCss;

  // Split into rule blocks
  const blocks = css
    .split('}')
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    // Ensure the block has a selector and declarations
    const parts = block.split('{').map((part) => part.trim());
    if (parts.length !== 2) {
      return { isValid: false, error: 'Invalid CSS structure' };
    }

    const [selector, decls] = parts;

    // Ensure selector is not empty
    if (!selector) {
      return { isValid: false, error: 'Missing selector' };
    }

    // Ensure declarations are not empty
    if (!decls) {
      return { isValid: false, error: `Missing declarations for selector: ${selector}` };
    }

    // Validate declarations
    const props = decls
      .split(';')
      .map((prop) => prop.trim())
      .filter(Boolean);

    if (props.length === 0) {
      return { isValid: false, error: `No valid properties for selector: ${selector}` };
    }

    for (const prop of props) {
      // Check if property is missing a name or value
      if (!prop.includes(':')) {
        return { isValid: false, error: `Missing property or value: ${prop}` };
      }

      const [name, value] = prop.split(':').map((part) => part.trim());
      if (!name) {
        return { isValid: false, error: `Missing property name: ${prop}` };
      }
      if (!value) {
        return { isValid: false, error: `Missing property value: ${prop}` };
      }

      // Validate full property format
      if (!propertyPattern.test(prop.endsWith(';') ? prop : prop + ';')) {
        return { isValid: false, error: `Invalid property: ${prop}` };
      }
    }
  }

  return { isValid: true, error: null };
};

export const formatCSS = (css: string): string => {
  // Simple formatter: adds indentation and line breaks
  const indent = '\t';
  let formatted = '';
  let depth = 0;
  let inComment = false;

  css = css.replace(/\s*\n\s*/g, '');
  css = css.replace(/\s{2,}/g, ' ').trim();
  css = css.replace(/([^\s{};][^{};]*:[^{};]+)\s*}/g, '$1;}');

  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    const nextTwoChars = css.slice(i, i + 2);

    if (nextTwoChars === '/*') {
      inComment = true;
      formatted += '\n' + indent.repeat(depth) + '/*';
      i++;
      continue;
    } else if (nextTwoChars === '*/' && inComment) {
      inComment = false;
      formatted += '*/\n' + indent.repeat(depth);
      i++;
      continue;
    }

    if (inComment) {
      formatted += char;
      continue;
    }

    if (char === '{') {
      depth++;
      formatted += ' {\n' + indent.repeat(depth);
    } else if (char === '}') {
      depth--;
      formatted += '\n' + indent.repeat(depth) + '}\n' + indent.repeat(depth);
    } else if (char === ';') {
      formatted += ';\n' + indent.repeat(depth);
      while (css[i + 1] === ' ' || css[i + 1] === ';') i++;
    } else {
      formatted += char;
    }
  }

  return formatted
    .replace(/\n([ \t]*\n)+/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
};
