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
    ...SERIF_FONTS.filter(
      (font) => font !== serif && font !== defaultCJKFont && !lastSerifFonts.includes(font),
    ),
    ...(defaultCJKFont !== serif ? [defaultCJKFont] : []),
    ...CJK_SERIF_FONTS.filter((font) => font !== serif && font !== defaultCJKFont),
    ...lastSerifFonts.filter(
      (font) => SERIF_FONTS.includes(font) && !lastSerifFonts.includes(defaultCJKFont),
    ),
    ...FALLBACK_FONTS,
  ];
  const sansSerifFonts = [
    sansSerif,
    ...SANS_SERIF_FONTS.filter((font) => font !== sansSerif && font !== defaultCJKFont),
    ...(defaultCJKFont !== sansSerif ? [defaultCJKFont] : []),
    ...CJK_SANS_SERIF_FONTS.filter((font) => font !== sansSerif && font !== defaultCJKFont),
    ...FALLBACK_FONTS,
  ];
  const monospaceFonts = [monospace, ...MONOSPACE_FONTS.filter((font) => font !== monospace)];
  const fontStyles = `
    html {
      --serif: ${serifFonts.map((font) => `"${font}"`).join(', ')}, serif;
      --sans-serif: ${sansSerifFonts.map((font) => `"${font}"`).join(', ')}, sans-serif;
      --monospace: ${monospaceFonts.map((font) => `"${font}"`).join(', ')}, monospace;
    }
    html, body {
      font-family: var(${defaultFont.toLowerCase() === 'serif' ? '--serif' : '--sans-serif'}) ${overrideFont ? '!important' : ''};
      font-size: ${fontSize}px !important;
      font-weight: ${fontWeight};
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
    body * {
      ${overrideFont ? 'font-family: revert !important;' : ''}
    }
    
  `;
  return fontStyles;
};

const getColorStyles = (
  overrideColor: boolean,
  invertImgColorInDark: boolean,
  themeCode: ThemeCode,
) => {
  const { bg, fg, primary, isDarkMode } = themeCode;
  const colorStyles = `
    html {
      --theme-bg-color: ${bg};
      --theme-fg-color: ${fg};
      --theme-primary-color: ${primary};
      color-scheme: ${isDarkMode ? 'dark' : 'light'};
    }
    html, body {
      color: ${fg};
    }
    div, p, span, pre , h1, h2, h3, h4, h5, h6 {
      ${overrideColor ? `background-color: ${bg} !important;` : ''}
      ${overrideColor ? `color: ${fg} !important;` : ''}
    }
    a:any-link {
      ${overrideColor ? `color: ${primary};` : isDarkMode ? `color: lightblue;` : ''}
      text-decoration: none;
    }
    p:has(img), span:has(img) {
      background-color: ${bg};
    }
    body.pbg {
      ${isDarkMode ? `background-color: ${bg} !important;` : ''}
    }
    img {
      ${isDarkMode && invertImgColorInDark ? 'filter: invert(100%);' : ''}
    }
    /* inline images */
    p img, span img, sup img {
      mix-blend-mode: ${isDarkMode ? 'screen' : 'multiply'};
    }
    /* override inline hardcoded text color */
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
  html[has-background], body[has-background] {
    --background-set: var(--theme-bg-color);
  }
  html, body {
    ${writingMode === 'auto' ? '' : `writing-mode: ${writingMode} !important;`}
    text-align: var(--default-text-align);
    max-height: unset;
  }
  html {
    background-color: var(--theme-bg-color, transparent);
    background: var(--background-set, none);
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
  p, li, blockquote, dd, div:not(:has(*:not(b, a, em, i, strong, u, span))) {
    line-height: ${lineSpacing} ${overrideLayout ? '!important' : ''};
    word-spacing: ${wordSpacing}px ${overrideLayout ? '!important' : ''};
    letter-spacing: ${letterSpacing}px ${overrideLayout ? '!important' : ''};
    text-indent: ${vertical ? textIndent * 1.2 : textIndent}em ${overrideLayout ? '!important' : ''};
    ${justify ? `text-align: justify ${overrideLayout ? '!important' : ''};` : ''}
    ${!justify && overrideLayout ? 'text-align: unset !important;' : ''};
    -webkit-hyphens: ${hyphenate ? 'auto' : 'manual'};
    hyphens: ${hyphenate ? 'auto' : 'manual'};
    -webkit-hyphenate-limit-before: 3;
    -webkit-hyphenate-limit-after: 2;
    -webkit-hyphenate-limit-lines: 2;
    hanging-punctuation: allow-end last;
    widows: 2;
  }
  p:has(> img:only-child), p:has(> span:only-child > img:only-child) {
    text-indent: unset !important;
  }
  p {
    ${vertical ? `margin-left: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${vertical ? `margin-right: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${!vertical ? `margin-top: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
    ${!vertical ? `margin-bottom: ${paragraphMargin}em ${overrideLayout ? '!important' : ''};` : ''}
  }
  div {
    ${vertical && overrideLayout ? `margin-left: ${paragraphMargin}em !important;` : ''}
    ${vertical && overrideLayout ? `margin-right: ${paragraphMargin}em !important;` : ''}
    ${!vertical && overrideLayout ? `margin-top: ${paragraphMargin}em !important;` : ''}
    ${!vertical && overrideLayout ? `margin-bottom: ${paragraphMargin}em !important;` : ''}
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

  /* inline images without dimension */
  p > img, span > img, sup img {
    height: 1em;
  }
  p:has(> img:only-child) img, span:has(> img:only-child) img {
    height: auto;
  }

  /* workaround for some badly designed epubs */
  div.left *, p.left * { text-align: left; }
  div.right *, p.right * { text-align: right; }
  div.center *, p.center * { text-align: center; }
  div.justify *, p.justify * { text-align: justify; }

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
    text-decoration: none;
  }

  ol {
    margin: 0;
    padding: 0;
  }

  p, li, blockquote, dd {
    margin: unset !important;
    text-indent: unset !important;
  }
`;

const getTranslationStyles = () => `
  .translation-block-wrapper {
    display: block !important;
    margin: 0.5em 0 !important;
  }
  .translation-target.hidden {
    display: none !important;
  }
`;

const getHighlightJsStyles = (themeCode: ThemeCode) => {
  const { isDarkMode } = themeCode;
  return isDarkMode
    ? `
  pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}/*!
  Theme: GitHub Dark
  Description: Dark theme as seen on github.com
  Author: github.com
  Maintainer: @Hirse
  Updated: 2021-05-15

  Outdated base version: https://github.com/primer/github-syntax-dark
  Current colors taken from GitHub's CSS
*/.hljs{color:#c9d1d9;background:#0d1117}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#ff7b72}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#d2a8ff}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#79c0ff}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#a5d6ff}.hljs-built_in,.hljs-symbol{color:#ffa657}.hljs-code,.hljs-comment,.hljs-formula{color:#8b949e}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#7ee787}.hljs-subst{color:#c9d1d9}.hljs-section{color:#1f6feb;font-weight:700}.hljs-bullet{color:#f2cc60}.hljs-emphasis{color:#c9d1d9;font-style:italic}.hljs-strong{color:#c9d1d9;font-weight:700}.hljs-addition{color:#aff5b4;background-color:#033a16}.hljs-deletion{color:#ffdcd7;background-color:#67060c}
  `
    : `
  pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}/*!
  Theme: GitHub
  Description: Light theme as seen on github.com
  Author: github.com
  Maintainer: @Hirse
  Updated: 2021-05-15

  Outdated base version: https://github.com/primer/github-syntax-light
  Current colors taken from GitHub's CSS
*/.hljs{color:#24292e;background:#fff}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#d73a49}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#6f42c1}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#005cc5}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#032f62}.hljs-built_in,.hljs-symbol{color:#e36209}.hljs-code,.hljs-comment,.hljs-formula{color:#6a737d}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#22863a}.hljs-subst{color:#24292e}.hljs-section{color:#005cc5;font-weight:700}.hljs-bullet{color:#735c0f}.hljs-emphasis{color:#24292e;font-style:italic}.hljs-strong{color:#24292e;font-weight:700}.hljs-addition{color:#22863a;background-color:#f0fff4}.hljs-deletion{color:#b31d28;background-color:#ffeef0}
  `;
};

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
    viewSettings.paragraphMargin!,
    viewSettings.lineHeight!,
    viewSettings.wordSpacing!,
    viewSettings.letterSpacing!,
    viewSettings.textIndent!,
    viewSettings.fullJustification!,
    viewSettings.hyphenation!,
    viewSettings.zoomLevel! / 100.0,
    viewSettings.writingMode!,
    viewSettings.vertical!,
  );
  // scale the font size on-the-fly so that we can sync the same font size on different devices
  const isMobile = ['ios', 'android'].includes(getOSPlatform());
  const fontScale = isMobile ? 1.25 : 1;
  const fontStyles = getFontStyles(
    viewSettings.serifFont!,
    viewSettings.sansSerifFont!,
    viewSettings.monospaceFont!,
    viewSettings.defaultFont!,
    viewSettings.defaultCJKFont!,
    viewSettings.defaultFontSize! * fontScale,
    viewSettings.minimumFontSize!,
    viewSettings.fontWeight!,
    viewSettings.overrideFont!,
  );
  const colorStyles = getColorStyles(
    viewSettings.overrideColor!,
    viewSettings.invertImgColorInDark!,
    themeCode,
  );
  const translationStyles = getTranslationStyles();
  const userStylesheet = viewSettings.userStylesheet!;
  const highlightJsStyles = getHighlightJsStyles(themeCode);
  return `${layoutStyles}\n${fontStyles}\n${colorStyles}\n${translationStyles}\n${userStylesheet}\n${highlightJsStyles}`;
};

export const transformStylesheet = (
  viewSettings: ViewSettings,
  width: number,
  height: number,
  css: string,
) => {
  const isMobile = ['ios', 'android'].includes(getOSPlatform());
  const fontScale = isMobile ? 1.25 : 1;
  const w = width * (1 - viewSettings.gapPercent / 100);
  const h = height - viewSettings.marginPx * 2;
  const ruleRegex = /([^{]+)({[^}]+})/g;
  css = css.replace(ruleRegex, (match, selector, block) => {
    const hasTextAlignCenter = /text-align\s*:\s*center\s*[;$]/.test(block);
    const hasTextIndentZero = /text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?\s*[;$]/.test(block);

    if (hasTextAlignCenter) {
      block = block.replace(/(text-align\s*:\s*center)(\s*;|\s*$)/g, '$1 !important$2');
      if (hasTextIndentZero) {
        block = block.replace(
          /(text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?)(\s*;|\s*$)/g,
          '$1 !important$2',
        );
      }
      return selector + block;
    }
    return match;
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
    .replace(/(\d*\.?\d+)vw/gi, (_, d) => (parseFloat(d) * w) / 100 + 'px')
    .replace(/(\d*\.?\d+)vh/gi, (_, d) => (parseFloat(d) * h) / 100 + 'px')
    .replace(/[\s;]color\s*:\s*black/gi, 'color: var(--theme-fg-color)')
    .replace(/[\s;]color\s*:\s*#000000/gi, 'color: var(--theme-fg-color)')
    .replace(/[\s;]color\s*:\s*#000/gi, 'color: var(--theme-fg-color)')
    .replace(/[\s;]color\s*:\s*rgb\(0,\s*0,\s*0\)/gi, 'color: var(--theme-fg-color)');
  return css;
};
