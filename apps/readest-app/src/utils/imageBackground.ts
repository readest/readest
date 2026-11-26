import tinycolor from 'tinycolor2';

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

// Dark mode draws a monochrome image (gaiji, an inline glyph, a line-art
// diagram) as ink in the theme's text color on a transparent ground, so it sits
// on any page color or texture (#7981). Inverting and screen-blending it left a
// black box wherever the page wasn't black: the page color is painted outside
// the section's iframe, so the blend had nothing to lighten.
//
// The color is part of the filter's id, so a theme change also changes the
// style that names it. WebKit kept drawing the old filter when only the node
// under an unchanged id was replaced.
const DARK_MONOCHROME_FILTER_ID = 'readest-dark-monochrome';

const darkMonochromeFilterId = (fgColor: string) =>
  `${DARK_MONOCHROME_FILTER_ID}-${tinycolor(fgColor).toHex()}`;

export const getDarkMonochromeFilter = (fgColor: string) =>
  `url(#${darkMonochromeFilterId(fgColor)})`;

const darkMonochromeSvg = (fgColor: string) => {
  const { r, g, b } = tinycolor(fgColor).toRgb();
  const [fr, fg, fb] = [r, g, b].map((c) => (c / 255).toFixed(4));
  // The ink color: the text color plus the pixel's own chroma (its color minus
  // its luma), so black ink takes the text color and a red accent stays red.
  // The fg sits in the constant column: SVG works on unpremultiplied colors,
  // so a half-transparent edge keeps the full text color.
  const tint = [
    `0.7010 -0.5870 -0.1140 0 ${fr}`,
    `-0.2990 0.4130 -0.1140 0 ${fg}`,
    `-0.2990 -0.5870 0.8860 0 ${fb}`,
    '0 0 0 1 0',
  ].join(' ');
  // How much ink a pixel holds: 1 - min(R, G, B), scaled so channels at 245 or
  // more count as paper. Each channel's 1 - k·c goes to red, `lighten` keeps
  // the largest, and the last matrix moves it to alpha. Black and saturated
  // colors stay opaque, white and off-white paper turn clear.
  const inkR = '-1.0418 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1';
  const inkG = '0 -1.0418 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1';
  const inkB = '0 0 -1.0418 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg">` +
    `<filter id="${darkMonochromeFilterId(fgColor)}" color-interpolation-filters="sRGB">` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="tinted" values="${tint}"/>` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="r" values="${inkR}"/>` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="g" values="${inkG}"/>` +
    `<feColorMatrix in="SourceGraphic" type="matrix" result="b" values="${inkB}"/>` +
    `<feBlend in="r" in2="g" mode="lighten" result="rg"/>` +
    `<feBlend in="rg" in2="b" mode="lighten"/>` +
    `<feColorMatrix type="matrix" result="ink" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/>` +
    `<feComposite in="tinted" in2="ink" operator="in"/>` +
    `</filter></svg>`
  );
};

export const mountWhiteTransparencyFilter = (doc: Document) => {
  if (!doc.head || doc.getElementById(FILTER_ID)) return;
  const svg = new DOMParser().parseFromString(whiteTransparencySvg, 'image/svg+xml');
  doc.head.appendChild(doc.importNode(svg.documentElement, true));
};

export const mountDarkMonochromeFilter = (doc: Document, fgColor: string) => {
  if (!doc.head || doc.getElementById(darkMonochromeFilterId(fgColor))) return;
  const svg = new DOMParser().parseFromString(darkMonochromeSvg(fgColor), 'image/svg+xml');
  doc.head.appendChild(doc.importNode(svg.documentElement, true));
};
