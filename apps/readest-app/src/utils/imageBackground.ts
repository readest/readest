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

export const mountWhiteTransparencyFilter = (doc: Document) => {
  if (!doc.head || doc.getElementById(FILTER_ID)) return;
  const svg = new DOMParser().parseFromString(whiteTransparencySvg, 'image/svg+xml');
  doc.head.appendChild(doc.importNode(svg.documentElement, true));
};
