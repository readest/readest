// Classify the original sRGB channels before inversion or contrast. Only pixels
// whose three channels are at least 245 become transparent; other colors and
// existing alpha are preserved.
const FILTER_ID = 'readest-white-transparent';
const whiteTransparencySvg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="${FILTER_ID}" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="255" intercept="-244"/><feFuncG type="linear" slope="255" intercept="-244"/><feFuncB type="linear" slope="255" intercept="-244"/></feComponentTransfer><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 -2"/><feComposite in="SourceGraphic" operator="out"/></filter></svg>`;

// WebKit resolves a filter url() only in the document that uses it: one in a
// data: URL drew no filter on iOS, iPadOS or macOS (#7391). So every document
// gets its own copy, in <head>, so the body's child indices, which CFIs count,
// stay the same.
export const WHITE_TRANSPARENCY_FILTER = `url(#${FILTER_ID})`;

const DARK_MONOCHROME_FILTER_ID = 'readest-dark-monochrome';
export const DARK_MONOCHROME_FILTER = `url(#${DARK_MONOCHROME_FILTER_ID})`;

const parseFgColor = (color: string): [number, number, number] => {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return [
        parseInt(hex[0]! + hex[0]!, 16) / 255,
        parseInt(hex[1]! + hex[1]!, 16) / 255,
        parseInt(hex[2]! + hex[2]!, 16) / 255,
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      ];
    }
  }
  const rgb = trimmed.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  }
  return [0xe0 / 255, 0xe0 / 255, 0xe0 / 255];
};

const buildDarkMonochromeSvg = (fgColor: string) => {
  const [fr, fg, fb] = parseFgColor(fgColor);
  const f = (n: number) => n.toFixed(4);
  // 1. Tint neutral ink to theme fg (column 5 = constant offset so non-premultiplied
  //    semi-transparent black keeps full fg brightness) while preserving chroma & SourceAlpha.
  const tintMatrix = [
    `0.7010 -0.5870 -0.1140 0 ${f(fr)}`,
    `-0.2990 0.4130 -0.1140 0 ${f(fg)}`,
    `-0.2990 -0.5870 0.8860 0 ${f(fb)}`,
    `0 0 0 1 0`,
  ].join(' ');
  // 2. Compute whiteness-to-ink mask: max(1 - 1.0418*R, 1 - 1.0418*G, 1 - 1.0418*B)
  //    = 1 - 1.0418 * min(R, G, B). Near-white (>= 245/255) becomes alpha = 0,
  //    while saturated colors (e.g. yellow/red) keep alpha = 1 and semi-transparent
  //    gray stays visible.
  const invR = `-1.0418 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1`;
  const invG = `0 -1.0418 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1`;
  const invB = `0 0 -1.0418 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1`;
  const rToAlpha = `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" data-readest-filter="dark-monochrome" data-fg="${fgColor}">` +
    `<filter id="${DARK_MONOCHROME_FILTER_ID}" color-interpolation-filters="sRGB">` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="tinted" values="${tintMatrix}"/>` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="invR" values="${invR}"/>` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="invG" values="${invG}"/>` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="invB" values="${invB}"/>` +
    `<feBlend in="invR" in2="invG" mode="lighten" result="maxRG"/>` +
    `<feBlend in="maxRG" in2="invB" mode="lighten" result="maxRGB"/>` +
    `<feColorMatrix in="maxRGB" type="matrix" result="inkMask" values="${rToAlpha}"/>` +
    `<feComposite in="tinted" in2="inkMask" operator="in"/>` +
    `</filter></svg>`
  );
};

export const mountWhiteTransparencyFilter = (doc: Document) => {
  if (!doc.head || doc.getElementById(FILTER_ID)) return;
  const svg = new DOMParser().parseFromString(whiteTransparencySvg, 'image/svg+xml');
  doc.head.appendChild(doc.importNode(svg.documentElement, true));
};

export const mountDarkMonochromeFilter = (doc: Document, fgColor: string) => {
  if (!doc.head) return;
  const existing = doc.getElementById(DARK_MONOCHROME_FILTER_ID)?.closest('svg');
  if (existing?.getAttribute('data-fg') === fgColor) return;
  const svg = new DOMParser().parseFromString(buildDarkMonochromeSvg(fgColor), 'image/svg+xml');
  const node = doc.importNode(svg.documentElement, true);
  if (existing) {
    existing.replaceWith(node);
  } else {
    doc.head.appendChild(node);
  }
};
