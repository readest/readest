// jsdom does not implement the CSS namespace; foliate-js TTS uses CSS.escape
// (mark[name="…"] lookups). Provide the standard polyfill so those paths work.
const globalWithCSS = globalThis as { CSS?: { escape?: (value: string) => string } };
if (!globalWithCSS.CSS) globalWithCSS.CSS = {};
if (typeof globalWithCSS.CSS.escape !== 'function') {
  globalWithCSS.CSS.escape = (value: string): string => {
    const string = String(value);
    const length = string.length;
    const firstCodeUnit = string.charCodeAt(0);
    let result = '';
    let index = -1;
    while (++index < length) {
      const codeUnit = string.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += '�';
      } else if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += '\\' + codeUnit.toString(16) + ' ';
      } else if (index === 0 && length === 1 && codeUnit === 0x002d) {
        result += '\\' + string.charAt(index);
      } else if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += string.charAt(index);
      } else {
        result += '\\' + string.charAt(index);
      }
    }
    return result;
  };
}

// matchMedia mock
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
