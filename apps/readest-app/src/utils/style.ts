import { MONOSPACE_FONTS, SANS_SERIF_FONTS, SERIF_FONTS } from '@/services/constants';
import { ViewSettings } from '@/types/book';

import fontfacesCSS from '!!raw-loader!../styles/fonts.css';

const getFontStyles = (
  serif: string,
  sansSerif: string,
  monospace: string,
  defaultFont: string,
  fontSize: number,
  overrideFont: boolean,
) => {
  const serifFonts = [serif, ...SERIF_FONTS.filter((font) => font !== serif)];
  const sansSerifFonts = [sansSerif, ...SANS_SERIF_FONTS.filter((font) => font !== sansSerif)];
  const monospaceFonts = [monospace, ...MONOSPACE_FONTS.filter((font) => font !== monospace)];
  const fontStyles = `
    html {
      --serif: ${serifFonts.map((font) => `"${font}"`).join(', ')}, serif;
      --sans-serif: ${sansSerifFonts.map((font) => `"${font}"`).join(', ')}, sans-serif;
      --monospace: ${monospaceFonts.map((font) => `"${font}"`).join(', ')}, monospace;
    }
    body * {
      font-size: ${fontSize}px ${overrideFont ? '!important' : ''};
      font-family: revert ${overrideFont ? '!important' : ''};
      font-family: var(${defaultFont.toLowerCase() === 'serif' ? '--serif' : '--sans-serif'}) ${overrideFont ? '!important' : ''};
    }
  `;
  return fontStyles;
};

const getAdditionalFontFaces = () => `
  @font-face {
    font-family: "FangSong";
    src: url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.eot");
    src: url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.eot?#iefix") format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.woff2") format("woff2"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.woff") format("woff"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.ttf") format("truetype"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.svg#FangSong") format("svg");
  }
  @font-face {
    font-family: "Kaiti";
    src: url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.eot");
    src: url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.eot?#iefix")format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.woff2")format("woff2"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.woff")format("woff"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.ttf")format("truetype"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.svg#STKaiti")format("svg");
  }
  @font-face {
    font-family: "Heiti";
    src: url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.eot");
    src: url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.eot?#iefix")format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.woff2")format("woff2"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.woff")format("woff"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.ttf")format("truetype"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.svg#WenQuanYi Micro Hei")format("svg");
  }
`;

const getLayoutStyles = (
  spacing: number,
  justify: boolean,
  hyphenate: boolean,
  zoomLevel: number,
  bg: string,
  fg: string,
  primary: string,
) => `
  @namespace epub "http://www.idpf.org/2007/ops";
  html {
    color-scheme: light dark;
    color: ${fg};
  }
  a:any-link {
    color: ${primary};
  }
  aside[epub|type~="footnote"] {
    display: none;
  }
  /* https://github.com/whatwg/html/issues/5426 */
  @media (prefers-color-scheme: dark) {
    a:link {
        color: lightblue;
    }
  }
  
  html {
    line-height: ${spacing};
    hanging-punctuation: allow-end last;
    orphans: 2;
    widows: 2;
  }
  [align="left"] { text-align: left; }
  [align="right"] { text-align: right; }
  [align="center"] { text-align: center; }
  [align="justify"] { text-align: justify; }
  :is(hgroup, header) p {
      text-align: unset;
      hyphens: unset;
  }
  pre {
      white-space: pre-wrap !important;
      tab-size: 2;
  }
  html, body {
    color: ${fg};
  }
  body *:not(a):not(#b1):not(#b1 *):not(#b2):not(#b2 *):not(.bg):not(.bg *):not(.vol):not(.vol *):not(.background):not(.background *) {
    border-color: currentColor !important;
    ${bg === '#ffffff' ? '' : `color: inherit;`}
    ${bg === '#ffffff' ? '' : `background-color: ${bg} !important;`}
  }
  body * {
    zoom: ${zoomLevel};
  }
  svg, img {
    background-color: transparent !important;
  }
  p, li, blockquote, dd {
    text-align: ${justify ? 'justify' : 'start'};
    -webkit-hyphens: ${hyphenate ? 'auto' : 'manual'};
    hyphens: ${hyphenate ? 'auto' : 'manual'};
    -webkit-hyphenate-limit-before: 3;
    -webkit-hyphenate-limit-after: 2;
    -webkit-hyphenate-limit-lines: 2;
    hanging-punctuation: allow-end last;
    widows: 2;
  }
  /* prevent the above from overriding the align attribute */
  [align="left"] { text-align: left; }
  [align="right"] { text-align: right; }
  [align="center"] { text-align: center; }
  [align="justify"] { text-align: justify; }

  pre {
    white-space: pre-wrap !important;
  }
  aside[epub|type~="endnote"],
  aside[epub|type~="footnote"],
  aside[epub|type~="note"],
  aside[epub|type~="rearnote"] {
    display: none;
  }

  .duokan-footnote-content,
  .duokan-footnote-item {
    display: none;
  }
`;

export interface ThemeCode {
  bg: string;
  fg: string;
  primary: string;
}

export const getStyles = (viewSettings: ViewSettings, themeCode: ThemeCode) => {
  const layoutStyles = getLayoutStyles(
    viewSettings.lineHeight!,
    viewSettings.fullJustification!,
    viewSettings.hyphenation!,
    viewSettings.zoomLevel! / 100.0,
    themeCode.bg,
    themeCode.fg,
    themeCode.primary,
  );
  const fontStyles = getFontStyles(
    viewSettings.serifFont!,
    viewSettings.sansSerifFont!,
    viewSettings.monospaceFont!,
    viewSettings.defaultFont!,
    viewSettings.defaultFontSize!,
    viewSettings.overrideFont!,
  );
  const userStylesheet = viewSettings.userStylesheet!;
  return `${layoutStyles}\n${fontStyles}\n${fontfacesCSS}\n${userStylesheet}`;
};

export const mountAdditionalFonts = (document: Document) => {
  const style = document.createElement('style');
  style.textContent = getAdditionalFontFaces();
  document.head.appendChild(style);
};
