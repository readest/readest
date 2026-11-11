// Classify the original sRGB channels before inversion or contrast. Only pixels
// whose three channels are at least 245 become transparent; other colors and
// existing alpha are preserved. A data URL also works in footnotes and the image
// viewer without referring back to an iframe's document.
const whiteTransparencySvg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="readest-white-transparent" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="255" intercept="-244"/><feFuncG type="linear" slope="255" intercept="-244"/><feFuncB type="linear" slope="255" intercept="-244"/></feComponentTransfer><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 -2"/><feComposite in="SourceGraphic" operator="out"/></filter></svg>`;

export const WHITE_TRANSPARENCY_FILTER = `url("data:image/svg+xml,${encodeURIComponent(whiteTransparencySvg)}#readest-white-transparent")`;
