import { ViewSettings } from '@/types/book';
import hljs from 'highlight.js/lib/common';

export const CODE_LANGUAGES = [
  'auto-detect',
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'graphql',
  'ini',
  'java',
  'javascript',
  'json',
  'kotlin',
  'less',
  'lua',
  'makefile',
  'markdown',
  'objectivec',
  'perl',
  'php',
  'php-t',
  'python',
  'python-r',
  'r',
  'ruby',
  'rust',
  'scss',
  'shell',
  'sql',
  'swift',
  'typescript',
  'vbnet',
  'wasm',
  'xml',
  'yaml',
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Toggle on or off the highlightjs stylesheet from the DOM and add relevant language styles */
export const manageSyntaxHighlighting = (doc: Document, viewSettings: ViewSettings) => {
  const styleId = 'highlight-js-theme-style'; // arbitrary css id
  const { codeHighlighting, codeLanguage } = viewSettings;

  const existingStyleElement = doc.getElementById(styleId);
  if (existingStyleElement) {
    existingStyleElement.remove();
  }

  if (!codeHighlighting) {
    // If disabling, remove the stylesheet and applied classes
    const styleElement = doc.getElementById(styleId);
    if (styleElement) styleElement.remove();
    doc.querySelectorAll('pre').forEach((block) => {
      if ((block as HTMLElement).dataset['highlighted']) {
        block.innerHTML = block.textContent || '';
      }
    });
    return;
  }

  const style = doc.createElement('style');
  style.id = styleId;
  style.textContent = getHighlightJsStyles();
  doc.head.appendChild(style);

  // Find all <pre> elements in available content
  const codeBlocks = doc.querySelectorAll('pre');

  // https://github.com/highlightjs/highlight.js/wiki/security
  // I believe this is valid in this use case to ignore this warning.
  hljs.configure({ ignoreUnescapedHTML: true });

  codeBlocks.forEach((block) => {
    // remove any previously applied classes by hljs
    block.innerHTML = block.textContent || '';
    block.className = block.className.replace(/language-\S+/g, '');
    block.classList.remove('hljs');
    block.removeAttribute('data-highlighted');
    if (codeLanguage && codeLanguage !== 'auto-detect') {
      block.classList.add(`language-${codeLanguage}`);
    }
    hljs.highlightElement(block as HTMLElement);
  });
};

/** Return either github light or dark theme */
const getHighlightJsStyles = () => {
  // Potential improvement: add more themes following this pattern.
  const githubLightTheme = `
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
  const githubDarkTheme = `
  @media (prefers-color-scheme: dark) {
    pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}/*!
    Theme: GitHub Dark
    Description: Dark theme as seen on github.com
    Author: github.com
    Maintainer: @Hirse
    Updated: 2021-05-15
    
    Outdated base version: https://github.com/primer/github-syntax-dark
    Current colors taken from GitHub's CSS
    */.hljs{color:#c9d1d9;background:#0d1117}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#ff7b72}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#d2a8ff}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#79c0ff}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#a5d6ff}.hljs-built_in,.hljs-symbol{color:#ffa657}.hljs-code,.hljs-comment,.hljs-formula{color:#8b949e}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#7ee787}.hljs-subst{color:#c9d1d9}.hljs-section{color:#1f6feb;font-weight:700}.hljs-bullet{color:#f2cc60}.hljs-emphasis{color:#c9d1d9;font-style:italic}.hljs-strong{color:#c9d1d9;font-weight:700}.hljs-addition{color:#aff5b4;background-color:#033a16}.hljs-deletion{color:#ffdcd7;background-color:#67060c}
  }`;
  const githubTheme = `${githubLightTheme}\n${githubDarkTheme}`;
  return githubTheme;
};
