const cssValidate = (css: string) => {
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

export default cssValidate;
