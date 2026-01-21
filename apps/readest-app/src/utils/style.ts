import {
  MONOSPACE_FONTS,
  SANS_SERIF_FONTS,
  SERIF_FONTS,
  FALLBACK_FONTS,
  CJK_SANS_SERIF_FONTS,
  CJK_SERIF_FONTS,
} from '@/services/constants';
import { ViewSettings } from '@/types/book';
import {
  themes,
  Palette,
  CustomTheme,
  generateLightPalette,
  generateDarkPalette,
} from '@/styles/themes';
import { getOSPlatform } from './misc';

const getFontStyles = (
  serif: string,
  sansSerif: string,
  monospace: string,
  defaultFont: string,
  defaultCJKFont: string,
  fontSize: number,
  minFontSize: number,
  fontWeight: number,
  overrideFont: boolean,
) => {
  const lastSerifFonts = ['Georgia', 'Times New Roman'];
  const serifFonts = [
    serif,
    ...(defaultCJKFont !== serif ? [defaultCJKFont] : []),
    ...SERIF_FONTS.filter(
      (font) => font !== serif && font !== defaultCJKFont && !lastSerifFonts.includes(font),
    ),
    ...CJK_SERIF_FONTS.filter((font) => font !== serif && font !== defaultCJKFont),
    ...lastSerifFonts.filter(
      (font) => SERIF_FONTS.includes(font) && !lastSerifFonts.includes(defaultCJKFont),
    ),
    ...FALLBACK_FONTS,
  ];
  const sansSerifFonts = [
    sansSerif,
    ...(defaultCJKFont !== sansSerif ? [defaultCJKFont] : []),
    ...SANS_SERIF_FONTS.filter((font) => font !== sansSerif && font !== defaultCJKFont),
    ...CJK_SANS_SERIF_FONTS.filter((font) => font !== sansSerif && font !== defaultCJKFont),
    ...FALLBACK_FONTS,
  ];
  const monospaceFonts = [monospace, ...MONOSPACE_FONTS.filter((font) => font !== monospace)];
  const defaultFontFamily = defaultFont.toLowerCase() === 'serif' ? '--serif' : '--sans-serif';
  const fontStyles = `
    html {
      --serif: ${serifFonts.map((font) => `"${font}"`).join(', ')}, serif;
      --sans-serif: ${sansSerifFonts.map((font) => `"${font}"`).join(', ')}, sans-serif;
      --monospace: ${monospaceFonts.map((font) => `"${font}"`).join(', ')}, monospace;
      --font-size: ${fontSize}px;
      --min-font-size: ${minFontSize}px;
      --font-weight: ${fontWeight};
    }
    html, body {
      font-size: ${fontSize}px !important;
      font-weight: ${fontWeight};
      -webkit-text-size-adjust: none;
      text-size-adjust: none;
    }
    /* lower specificity than ebook built-in font styles */
    html {
      font-family: var(${defaultFontFamily}) ${overrideFont ? '!important' : ''};
    }
    /* higher specificity than ebook built-in font styles */
    html body {
      ${overrideFont ? `font-family: var(${defaultFontFamily}) !important;` : ''}
    }
    font[size="1"] {
      font-size: ${minFontSize}px;
    }
    font[size="2"] {
      font-size: ${minFontSize * 1.5}px;
    }
    font[size="3"] {
      font-size: ${fontSize}px;
    }
    font[size="4"] {
      font-size: ${fontSize * 1.2}px;
    }
    font[size="5"] {
      font-size: ${fontSize * 1.5}px;
    }
    font[size="6"] {
      font-size: ${fontSize * 2}px;
    }
    font[size="7"] {
      font-size: ${fontSize * 3}px;
    }
    /* hardcoded inline font size */
    [style*="font-size: 16px"], [style*="font-size:16px"] {
      font-size: 1rem !important;
    }
    pre, code, kbd {
      font-family: var(--monospace);
    }
    body *:not(pre, code, kbd, .code):not(pre *, code *, kbd *, .code *) {
      ${overrideFont ? 'font-family: revert !important;' : ''}
    }
  `;
  return fontStyles;
};

const getColorStyles = (
  overrideColor: boolean,
  invertImgColorInDark: boolean,
  themeCode: ThemeCode,
  backgroundTextureId: string,
  isEink: boolean,
) => {
  const { bg, fg, primary, isDarkMode } = themeCode;
  const colorStyles = `
    html {
      --bg-texture-id: ${backgroundTextureId};
      --theme-bg-color: ${bg};
      --theme-fg-color: ${fg};
      --theme-primary-color: ${primary};
      --override-color: ${overrideColor};
      color-scheme: ${isDarkMode ? 'dark' : 'light'};
    }
    html, body {
      color: ${fg};
    }
    html[has-background], body[has-background] {
      --background-set: var(--theme-bg-color);
    }
    html {
      background-color: var(--theme-bg-color, transparent);
      background: var(--background-set, none);
    }
    section, aside, blockquote, article, nav, header, footer, main, figure,
    div, p, font, h1, h2, h3, h4, h5, h6, li, span {
      ${overrideColor ? `background-color: ${bg} !important;` : ''}
      ${overrideColor ? `color: ${fg} !important;` : ''}
      ${overrideColor ? `border-color: ${fg} !important;` : ''}
    }
    pre, span { /* inline code blocks */
      ${overrideColor ? `background-color: ${bg} !important;` : ''}
    }
    a:any-link {
      ${overrideColor ? `color: ${primary} !important;` : isDarkMode ? `color: lightblue;` : ''}
      text-decoration: ${isEink ? 'underline' : 'none'};
    }
    body.pbg {
      ${isDarkMode ? `background-color: ${bg} !important;` : ''}
    }
    img {
      ${isDarkMode && invertImgColorInDark ? 'filter: invert(100%);' : ''}
      ${!isDarkMode && overrideColor ? 'mix-blend-mode: multiply;' : ''}
    }
    /* horizontal rule #1649 */
    *:has(> hr.background-img):not(body) {
      background-color: ${bg};
    }
    hr {
      mix-blend-mode: multiply;
    }
    /* inline images */
    p img, span img, sup img {
      mix-blend-mode: ${isDarkMode ? 'screen' : 'multiply'};
    }
    table {
      max-width: calc(var(--available-width));
      overflow: auto;
      table-layout: fixed;
    }
    /* code */
    body.theme-dark code {
      ${isDarkMode ? `color: ${fg}cc;` : ''}
      ${isDarkMode ? `background: color-mix(in srgb, ${bg} 90%, #000);` : ''}
      ${isDarkMode ? `background-color: color-mix(in srgb, ${bg} 90%, #000);` : ''}
    }
    blockquote {
      ${isDarkMode ? `background: color-mix(in srgb, ${bg} 80%, #000);` : ''}
    }
    blockquote, table * {
      ${isDarkMode && overrideColor ? `background: color-mix(in srgb, ${bg} 80%, #000);` : ''}
      ${isDarkMode && overrideColor ? `background-color: color-mix(in srgb, ${bg} 80%, #000);` : ''}
    }
    /* override inline hardcoded text color */
    font[color="#000000"], font[color="#000"], font[color="black"],
    font[color="rgb(0,0,0)"], font[color="rgb(0, 0, 0)"],
    *[style*="color: rgb(0,0,0)"], *[style*="color: rgb(0, 0, 0)"],
    *[style*="color: #000"], *[style*="color: #000000"], *[style*="color: black"],
    *[style*="color:rgb(0,0,0)"], *[style*="color:rgb(0, 0, 0)"],
    *[style*="color:#000"], *[style*="color:#000000"], *[style*="color:black"] {
      color: ${fg} !important;
    }
    /* for the Gutenberg eBooks */
    #pg-header * {
      color: inherit !important;
    }
    .x-ebookmaker, .x-ebookmaker-cover, .x-ebookmaker-coverpage {
      background-color: unset !important;
    }
    /* for the Feedbooks eBooks */
    .chapterHeader, .chapterHeader * {
      border-color: unset;
      background-color: ${bg} !important;
    }
  `;
  return colorStyles;
};

const getLayoutStyles = (
  overrideLayout: boolean,
  marginTop: number,
  marginRight: number,
  marginBottom: number,
  marginLeft: number,
  paragraphMargin: number,
  lineSpacing: number,
  wordSpacing: number,
  letterSpacing: number,
  textIndent: number,
  justify: boolean,
  hyphenate: boolean,
  zoomLevel: number,
  writingMode: string,
  vertical: boolean,
) => {
  const layoutStyle = `
  @namespace epub "http://www.idpf.org/2007/ops";
  html {
    --default-text-align: ${justify ? 'justify' : 'start'};
    --margin-top: ${marginTop}px;
    --margin-right: ${marginRight}px;
    --margin-bottom: ${marginBottom}px;
    --margin-left: ${marginLeft}px;
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
  html, body {
    ${writingMode === 'auto' ? '' : `writing-mode: ${writingMode} !important;`}
    text-align: var(--default-text-align);
    max-height: unset;
    -webkit-touch-callout: none;
    -webkit-user-select: text;
  }
  body {
    overflow: unset;
    zoom: ${zoomLevel};
  }
  svg, img {
    height: auto;
    width: auto;
    background-color: transparent !important;
  }
  figure > div:has(img) {
    height: auto !important;
  }
  /* enlarge the clickable area of links */
  a {
    position: relative !important;
  }
  a::before {
    content: '';
    position: absolute;
    inset: -10px;
  }
  p, blockquote, dd, div:not(:has(*:not(b, a, em, i, strong, u, span))) {
    line-height: ${lineSpacing} ${overrideLayout ? '!important' : ''};
    word-spacing: ${wordSpacing}px ${overrideLayout ? '!important' : ''};
    letter-spacing: ${letterSpacing}px ${overrideLayout ? '!important' : ''};
    text-indent: ${textIndent}em ${overrideLayout ? '!important' : ''};
    -webkit-hyphens: ${hyphenate ? 'auto' : 'manual'};
    hyphens: ${hyphenate ? 'auto' : 'manual'};
    -webkit-hyphenate-limit-before: 3;
    -webkit-hyphenate-limit-after: 2;
    -webkit-hyphenate-limit-lines: 2;
    hanging-punctuation: allow-end last;
    widows: 2;
  }
  p.aligned-center, blockquote.aligned-center,
  dd.aligned-center, div.aligned-center {
    text-align: center ${overrideLayout ? '!important' : ''};
  }
  p.aligned-left, blockquote.aligned-left,
  dd.aligned-left, div.aligned-left {
    ${justify && overrideLayout ? 'text-align: justify !important;' : ''}
  }
  p.aligned-right, blockquote.aligned-right,
  dd.aligned-right, div.aligned-right {
    text-align: right ${overrideLayout ? '!important' : ''};
  }
  p.aligned-justify, blockquote.aligned-justify,
  dd.aligned-justify, div.aligned-justify {
    ${!justify && overrideLayout ? 'text-align: initial !important;' : ''};
  }
  p:has(> img:only-child), p:has(> span:only-child > img:only-child),
  p:has(> img:not(.has-text-siblings)),
  p:has(> a:first-child + img:last-child) {
    text-indent: initial !important;
  }
  blockquote[align="center"], div[align="center"],
  p[align="center"], dd[align="center"],
  p.aligned-center, blockquote.aligned-center,
  dd.aligned-center, div.aligned-center,
  li p, ol p, ul p, td p {
    text-indent: initial !important;
  }
  p {
    ${vertical ? `margin-left: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${vertical ? `margin-right: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${vertical ? `margin-top: unset ${overrideLayout ? '!important' : ''};` : ''}
    ${vertical ? `margin-bottom: unset ${overrideLayout ? '!important' : ''};` : ''}
    ${!vertical ? `margin-top: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${!vertical ? `margin-bottom: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${!vertical ? `margin-left: unset ${overrideLayout ? '!important' : ''};` : ''}
    ${!vertical ? `margin-right: unset ${overrideLayout ? '!important' : ''};` : ''}
  }
  div {
    ${vertical && overrideLayout ? `margin-left: ${paragraphMargin}em !important;` : ''}
    ${vertical && overrideLayout ? `margin-right: ${paragraphMargin}em !important;` : ''}
    ${!vertical && overrideLayout ? `margin-top: ${paragraphMargin}em !important;` : ''}
    ${!vertical && overrideLayout ? `margin-bottom: ${paragraphMargin}em !important;` : ''}
  }

  :lang(zh), :lang(ja), :lang(ko) {
    widows: 1;
    orphans: 1;
  }

  pre {
    white-space: pre-wrap !important;
  }

  .epubtype-footnote,
  aside[epub|type~="endnote"],
  aside[epub|type~="footnote"],
  aside[epub|type~="note"],
  aside[epub|type~="rearnote"] {
    display: none;
  }

  /* Now begins really dirty hacks to fix some badly designed epubs */
  body {
    line-height: unset;
  }

  img.pi {
    ${vertical ? 'transform: rotate(90deg);' : ''}
    ${vertical ? 'transform-origin: center;' : ''}
    ${vertical ? 'height: 2em;' : ''}
    ${vertical ? `width: ${lineSpacing}em;` : ''}
    ${vertical ? `vertical-align: unset;` : ''}
  }

  .duokan-footnote-content,
  .duokan-footnote-item {
    display: none;
  }

  .calibre {
    color: unset;
  }

  div:has(> img, > svg) {
    max-width: 100% !important;
  }

  body.paginated-mode td:has(img), body.paginated-mode td :has(img) {
    max-height: calc(var(--available-height) * 0.8 * 1px);
  }

  /* some epubs set insane inline-block for p */
  p {
    display: block;
  }

  /* inline images without dimension */
  .ie6 img {
    width: unset;
    height: unset;
  }
  sup img {
    height: 1em;
  }
  img.has-text-siblings {
    ${vertical ? 'width: 1em;' : 'height: 1em;'}
    vertical-align: baseline;
  }
  :is(div) > img.has-text-siblings[style*="object-fit"] {
    display: block;
    height: auto;
    vertical-align: unset;
  }
  .duokan-footnote img:not([class]) {
    width: 0.8em;
    height: 0.8em;
  }
  div:has(img.singlepage) {
    position: relative;
    width: auto;
    height: auto;
  }

  /* page break */
  body.paginated-mode div[style*="page-break-after: always"],
  body.paginated-mode div[style*="page-break-after:always"],
  body.paginated-mode p[style*="page-break-after: always"],
  body.paginated-mode p[style*="page-break-after:always"] {
    margin-bottom: calc(var(--available-height) * 1px);
  }

  /* workaround for some badly designed epubs */
  div.left *, p.left * { text-align: left; }
  div.right *, p.right * { text-align: right; }
  div.center *, p.center * { text-align: center; }
  div.justify *, p.justify * { text-align: justify; }

  .br {
    display: flow-root;
  }

  .h5_mainbody {
    overflow: unset !important;
  }

  .nonindent, .noindent {
    text-indent: unset !important;
  }
`;
  return layoutStyle;
};

export const getFootnoteStyles = () => `
  .duokan-footnote-content,
  .duokan-footnote-item {
    display: block !important;
  }

  body {
    padding: 1em !important;
  }

  a:any-link {
    cursor: default;
    pointer-events: none;
    text-decoration: none;
    padding: unset;
    margin: unset;
  }

  ol {
    margin: 0;
    padding: 0;
  }

  p, li, blockquote, dd {
    margin: unset !important;
    text-indent: unset !important;
  }

  div {
    margin: unset !important;
    padding: unset !important;
  }

  dt {
    font-weight: bold;
    line-height: 1.6;
  }

  .epubtype-footnote,
  aside[epub|type~="endnote"],
  aside[epub|type~="footnote"],
  aside[epub|type~="note"],
  aside[epub|type~="rearnote"] {
    display: block;
  }
`;

const getTranslationStyles = (showSource: boolean) => `
  .translation-source {
  }
  .translation-target {
  }
  .translation-target.hidden {
    display: none !important;
  }
  .translation-target-block {
    display: block !important;
    ${showSource ? 'margin: 0.5em 0 !important;' : ''}
  }
  .translation-target-toc {
    display: block !important;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

export interface ThemeCode {
  bg: string;
  fg: string;
  primary: string;
  palette: Palette;
  isDarkMode: boolean;
}

export const getThemeCode = () => {
  let themeMode = 'auto';
  let themeColor = 'default';
  let systemIsDarkMode = false;
  let customThemes: CustomTheme[] = [];
  if (typeof window !== 'undefined') {
    themeColor = localStorage.getItem('themeColor') || 'default';
    themeMode = localStorage.getItem('themeMode') || 'auto';
    customThemes = JSON.parse(localStorage.getItem('customThemes') || '[]');
    systemIsDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  const isDarkMode = themeMode === 'dark' || (themeMode === 'auto' && systemIsDarkMode);
  let currentTheme = themes.find((theme) => theme.name === themeColor);
  if (!currentTheme) {
    const customTheme = customThemes.find((theme) => theme.name === themeColor);
    if (customTheme) {
      currentTheme = {
        name: customTheme.name,
        label: customTheme.label,
        colors: {
          light: generateLightPalette(customTheme.colors.light),
          dark: generateDarkPalette(customTheme.colors.dark),
        },
      };
    }
  }
  if (!currentTheme) currentTheme = themes[0];
  const defaultPalette = isDarkMode ? currentTheme!.colors.dark : currentTheme!.colors.light;
  return {
    bg: defaultPalette['base-100'],
    fg: defaultPalette['base-content'],
    primary: defaultPalette.primary,
    palette: defaultPalette,
    isDarkMode,
  } as ThemeCode;
};

export const getStyles = (viewSettings: ViewSettings, themeCode?: ThemeCode) => {
  if (!themeCode) {
    themeCode = getThemeCode();
  }
  const layoutStyles = getLayoutStyles(
    viewSettings.overrideLayout!,
    viewSettings.marginTopPx,
    viewSettings.marginRightPx,
    viewSettings.marginBottomPx,
    viewSettings.marginLeftPx,
    viewSettings.paragraphMargin!,
    viewSettings.lineHeight!,
    viewSettings.wordSpacing!,
    viewSettings.letterSpacing!,
    viewSettings.textIndent!,
    viewSettings.fullJustification!,
    viewSettings.hyphenation!,
    1.0,
    viewSettings.writingMode!,
    viewSettings.vertical!,
  );
  // scale the font size on-the-fly so that we can sync the same font size on different devices
  const isMobile = ['ios', 'android'].includes(getOSPlatform());
  const fontScale = isMobile ? 1.25 : 1;
  // Only for backward compatibility, new viewSettings.zoomLevel will always be 100 for EPUBs
  const zoomScale = (viewSettings.zoomLevel || 100) / 100.0;
  const fontStyles = getFontStyles(
    viewSettings.serifFont!,
    viewSettings.sansSerifFont!,
    viewSettings.monospaceFont!,
    viewSettings.defaultFont!,
    viewSettings.defaultCJKFont!,
    viewSettings.defaultFontSize! * fontScale * zoomScale,
    viewSettings.minimumFontSize!,
    viewSettings.fontWeight!,
    viewSettings.overrideFont!,
  );
  const colorStyles = getColorStyles(
    viewSettings.overrideColor!,
    viewSettings.invertImgColorInDark!,
    themeCode,
    viewSettings.backgroundTextureId,
    viewSettings.isEink,
  );
  const translationStyles = getTranslationStyles(viewSettings.showTranslateSource!);
  const userStylesheet = viewSettings.userStylesheet!;
  return `${layoutStyles}\n${fontStyles}\n${colorStyles}\n${translationStyles}\n${userStylesheet}`;
};

export const applyTranslationStyle = (viewSettings: ViewSettings) => {
  const styleId = 'translation-style';

  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
  }

  const styleElement = document.createElement('style');
  styleElement.id = styleId;
  styleElement.textContent = getTranslationStyles(viewSettings.showTranslateSource);

  document.head.appendChild(styleElement);
};

export const transformStylesheet = (css: string, vw: number, vh: number, vertical: boolean) => {
  const isMobile = ['ios', 'android'].includes(getOSPlatform());
  const fontScale = isMobile ? 1.25 : 1;
  const isInlineStyle = !css.includes('{');
  const ruleRegex = /([^{]+)({[^}]+})/g;
  css = css.replace(ruleRegex, (match, selector, block) => {
    const hasTextAlignCenter = /text-align\s*:\s*center\s*[;$]/.test(block);
    const hasTextIndentZero = /text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?\s*[;$]/.test(block);

    if (hasTextAlignCenter && hasTextIndentZero) {
      block = block.replace(/(text-align\s*:\s*center)(\s*;|\s*$)/g, '$1 !important$2');
      block = block.replace(
        /(text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?)(\s*;|\s*$)/g,
        '$1 !important$2',
      );
      return selector + block;
    }
    return match;
  });

  // clip nowrapped elements
  css = css.replace(ruleRegex, (match, selector, block) => {
    const hasWhiteSpaceNowrap = /white-space\s*:\s*nowrap\s*[;$]/.test(block);
    if (hasWhiteSpaceNowrap) {
      if (!/overflow\s*:/.test(block)) {
        block = block.replace(/}$/, ' overflow: clip !important; }');
      }
      return selector + block;
    }
    return match;
  });

  if (isInlineStyle) {
    const hasPageBreakAfterAlways = /page-break-after\s*:\s*always\s*[;]?/.test(css);
    if (hasPageBreakAfterAlways && !/margin-bottom\s*:/.test(css)) {
      css = css.replace(/;?\s*$/, '') + '; margin-bottom: calc(var(--available-height) * 1px)';
    }
  } else {
    css = css.replace(ruleRegex, (match, selector, block) => {
      const hasPageBreakAfterAlways = /page-break-after\s*:\s*always\s*[;$]/.test(block);
      if (hasPageBreakAfterAlways) {
        if (!/margin-bottom\s*:/.test(block)) {
          block = block.replace(/}$/, ' margin-bottom: calc(var(--available-height) * 1px); }');
        }
        return selector + block;
      }
      return match;
    });
  }

  // Process duokan-bleed
  css = css.replace(ruleRegex, (_, selector, block) => {
    if (vertical) return selector + block;

    const directions: string[] = [];
    let hasBleed = false;
    for (const dir of ['top', 'bottom', 'left', 'right']) {
      const bleedRegex = new RegExp(`duokan-bleed\\s*:\\s*[^;]*${dir}[^;]*;`);
      const marginRegex = new RegExp(`margin-${dir}\\s*:`);
      if (bleedRegex.test(block) && !marginRegex.test(block)) {
        hasBleed = true;
        directions.push(dir);
        block = block.replace(
          /}$/,
          ` margin-${dir}: calc(-1 * var(--page-margin-${dir})) !important; }`,
        );
      }
    }
    if (hasBleed) {
      if (!/position\s*:/.test(block)) {
        block = block.replace(/}$/, ' position: relative !important; }');
      }
      if (!/overflow\s*:/.test(block)) {
        block = block.replace(/}$/, ' overflow: hidden !important; }');
      }
      if (!/display\s*:/.test(block)) {
        block = block.replace(/}$/, ' display: flow-root !important; }');
      }
      if (!/width\s*:/.test(block) && directions.includes('left') && directions.includes('right')) {
        block = block
          .replace(
            /}$/,
            ' width: calc(var(--_max-width) + var(--page-margin-left) + var(--page-margin-right)) !important; }',
          )
          .replace(/}$/, ' max-width: 100vw !important; }');
      }
      if (
        !/height\s*:/.test(block) &&
        directions.includes('top') &&
        directions.includes('bottom')
      ) {
        block = block
          .replace(
            /}$/,
            ' height: calc(100% + var(--page-margin-top) + var(--page-margin-bottom)) !important; }',
          )
          .replace(/}$/, ' max-height: 100vh !important; }');
      }
    }
    return selector + block;
  });

  // replace absolute font sizes with rem units
  // replace vw and vh as they cause problems with layout
  // replace hardcoded colors
  css = css
    .replace(/font-size\s*:\s*xx-small/gi, 'font-size: 0.6rem')
    .replace(/font-size\s*:\s*x-small/gi, 'font-size: 0.75rem')
    .replace(/font-size\s*:\s*small/gi, 'font-size: 0.875rem')
    .replace(/font-size\s*:\s*medium/gi, 'font-size: 1rem')
    .replace(/font-size\s*:\s*large/gi, 'font-size: 1.2rem')
    .replace(/font-size\s*:\s*x-large/gi, 'font-size: 1.5rem')
    .replace(/font-size\s*:\s*xx-large/gi, 'font-size: 2rem')
    .replace(/font-size\s*:\s*xxx-large/gi, 'font-size: 3rem')
    .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, (_, px) => {
      const rem = parseFloat(px) / fontScale / 16;
      return `font-size: ${rem}rem`;
    })
    .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)pt/gi, (_, pt) => {
      const rem = parseFloat(pt) / fontScale / 12;
      return `font-size: ${rem}rem`;
    })
    .replace(/font-size\s*:\s*(\d*\.?\d+)(px|rem|em|%)?/gi, (_, size, unit = 'px') => {
      return `font-size: max(${size}${unit}, var(--min-font-size, 8px))`;
    })
    .replace(/(\d*\.?\d+)vw/gi, (_, d) => (parseFloat(d) * vw) / 100 + 'px')
    .replace(/(\d*\.?\d+)vh/gi, (_, d) => (parseFloat(d) * vh) / 100 + 'px')
    .replace(/([\s;])font-family\s*:\s*monospace/gi, '$1font-family: var(--monospace)')
    .replace(/([\s;])font-weight\s*:\s*normal/gi, '$1font-weight: var(--font-weight)')
    .replace(/([\s;])color\s*:\s*black/gi, '$1color: var(--theme-fg-color)')
    .replace(/([\s;])color\s*:\s*#000000/gi, '$1color: var(--theme-fg-color)')
    .replace(/([\s;])color\s*:\s*#000/gi, '$1color: var(--theme-fg-color)')
    .replace(/([\s;])color\s*:\s*rgb\(0,\s*0,\s*0\)/gi, '$1color: var(--theme-fg-color)');
  return css;
};

export const applyThemeModeClass = (document: Document, isDarkMode: boolean) => {
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(isDarkMode ? 'theme-dark' : 'theme-light');
};

export const applyScrollModeClass = (document: Document, isScrollMode: boolean) => {
  document.body.classList.remove('scroll-mode', 'paginated-mode');
  document.body.classList.add(isScrollMode ? 'scroll-mode' : 'paginated-mode');
};

export const applyImageStyle = (document: Document) => {
  document.querySelectorAll('img').forEach((img) => {
    const widthAttr = img.getAttribute('width');
    if (widthAttr && (widthAttr.endsWith('%') || widthAttr.endsWith('vw'))) {
      const percentage = parseFloat(widthAttr);
      if (!isNaN(percentage)) {
        img.style.width = `${(percentage / 100) * window.innerWidth}px`;
        img.removeAttribute('width');
      }
    }

    const heightAttr = img.getAttribute('height');
    if (heightAttr && (heightAttr.endsWith('%') || heightAttr.endsWith('vh'))) {
      const percentage = parseFloat(heightAttr);
      if (!isNaN(percentage)) {
        img.style.height = `${(percentage / 100) * window.innerHeight}px`;
        img.removeAttribute('height');
      }
    }

    const parent = img.parentNode;
    if (!parent || parent.nodeType !== Node.ELEMENT_NODE) return;
    const hasTextSiblings = Array.from(parent.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    const isInline = Array.from(parent.childNodes).every(
      (node) => node.nodeType !== Node.ELEMENT_NODE || (node as Element).tagName !== 'BR',
    );
    if (hasTextSiblings && isInline) {
      img.classList.add('has-text-siblings');
    }
  });
  document.querySelectorAll('hr').forEach((hr) => {
    const computedStyle = window.getComputedStyle(hr);
    if (computedStyle.backgroundImage && computedStyle.backgroundImage !== 'none') {
      hr.classList.add('background-img');
    }
  });
};

export const applyTableStyle = (document: Document) => {
  document.querySelectorAll('table').forEach((table) => {
    const parent = table.parentNode;
    if (!parent || parent.nodeType !== Node.ELEMENT_NODE) return;

    // Calculate total width from td elements with width attribute or inline style
    let totalTableWidth = 0;
    const rows = table.querySelectorAll('tr');

    // Check all rows and use the widest one
    for (const row of rows) {
      const cells = row.querySelectorAll('td, th');
      let rowWidth = 0;

      cells.forEach((cell) => {
        const cellElement = cell as HTMLElement;

        const widthAttr = cellElement.getAttribute('width');
        const styleWidth = cellElement.style.width;
        const widthStr = widthAttr || styleWidth;

        if (widthStr) {
          const widthValue = parseFloat(widthStr);
          const widthUnit = widthStr.replace(widthValue.toString(), '').trim();

          if (widthUnit === 'px' || !widthUnit) {
            rowWidth += widthValue;
          } else if (widthUnit === '%') {
            rowWidth += (window.innerWidth * widthValue) / 100;
          }
        }
      });

      if (rowWidth > totalTableWidth) {
        totalTableWidth = rowWidth;
      }
    }

    if (totalTableWidth > 0) {
      const scale = `calc(min(1, var(--available-width) / ${totalTableWidth}))`;
      table.style.transformOrigin = 'left top';
      table.style.transform = `scale(${scale})`;
    }
  });
};

export const keepTextAlignment = (document: Document) => {
  document.querySelectorAll('div, p, blockquote, dd').forEach((el) => {
    const computedStyle = window.getComputedStyle(el);
    if (computedStyle.textAlign === 'center') {
      el.classList.add('aligned-center');
    } else if (computedStyle.textAlign === 'left') {
      el.classList.add('aligned-left');
    } else if (computedStyle.textAlign === 'right') {
      el.classList.add('aligned-right');
    } else if (computedStyle.textAlign === 'justify') {
      el.classList.add('aligned-justify');
    }
  });
};

export const applyFixedlayoutStyles = (
  document: Document,
  viewSettings: ViewSettings,
  themeCode?: ThemeCode,
) => {
  if (!themeCode) {
    themeCode = getThemeCode();
  }
  const { bg, fg, primary, isDarkMode } = themeCode;
  const overrideColor = viewSettings.overrideColor!;
  const invertImgColorInDark = viewSettings.invertImgColorInDark!;
  const darkMixBlendMode = bg === '#000000' ? 'luminosity' : 'overlay';
  const existingStyleId = 'fixed-layout-styles';
  let style = document.getElementById(existingStyleId) as HTMLStyleElement;
  if (style) {
    style.remove();
  }
  style = document.createElement('style');
  style.id = existingStyleId;
  style.textContent = `
    html {
      --theme-bg-color: ${bg};
      --theme-fg-color: ${fg};
      --theme-primary-color: ${primary};
      color-scheme: ${isDarkMode ? 'dark' : 'light'};
    }
    body {
      position: relative;
      background-color: var(--theme-bg-color);
    }
    #canvas {
      display: inline-block;
      width: fit-content;
      height: fit-content;
      background-color: var(--theme-bg-color);
    }
    img, canvas {
      ${isDarkMode && invertImgColorInDark ? 'filter: invert(100%);' : ''}
      ${overrideColor ? `mix-blend-mode: ${isDarkMode ? darkMixBlendMode : 'multiply'};` : ''}
    }
    img.singlePage {
      position: relative;
    }
  `;
  document.head.appendChild(style);
};
