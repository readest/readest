import { describe, test, expect, afterEach } from 'vitest';

import { getStyles, ThemeCode } from '@/utils/style';
import { ViewSettings } from '@/types/book';
import {
  createTranslationTargetNode,
  setSourceVisibility,
} from '@/app/reader/hooks/useTextTranslation';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

// The paragraph-layout rule only matches a <div> whose descendants are all
// inline formatting tags. Translation appends its <font> wrappers *inside* the
// source paragraph, so if <font> is not treated as inline formatting the
// enclosing <div> silently drops the rule and reverts to the book's default
// line spacing. Uses the real emitted CSS and the real :has() engine.
const LINE_HEIGHT = 2;
const FONT_SIZE_PX = 16;

function makeViewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...overrides,
  } as ViewSettings;
}

const themeCode: ThemeCode = {
  bg: '#ffffff',
  fg: '#000000',
  primary: '#3366cc',
  isDarkMode: false,
  palette: {
    'base-100': '#ffffff',
    'base-200': '#f0f0f0',
    'base-300': '#e0e0e0',
    'base-content': '#000000',
    neutral: '#808080',
    'neutral-content': '#ffffff',
    primary: '#3366cc',
    secondary: '#6699cc',
    accent: '#33cc99',
  },
} as ThemeCode;

const iframes: HTMLIFrameElement[] = [];

const renderSection = (bodyHtml: string) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  const style = doc.createElement('style');
  style.textContent =
    `html, body { font-size: ${FONT_SIZE_PX}px; }` +
    getStyles(makeViewSettings({ lineHeight: LINE_HEIGHT, useBookLayout: false }), themeCode);
  doc.head.appendChild(style);
  doc.body.innerHTML = bodyHtml;
  return { doc, win: iframe.contentWindow! };
};

const appendTranslation = (el: HTMLElement) =>
  el.appendChild(
    createTranslationTargetNode({
      translatedText: '译文',
      lang: 'zh',
      targetBlockClassName: 'translation-target-block',
      hidden: false,
      widthLineBreak: false,
    }),
  );

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('paragraph layout survives translation injection', () => {
  test('keeps a <div> paragraph line spacing after the translation node is appended', () => {
    const { doc, win } = renderSection(
      `<div class="para">Veganism is experiencing unprecedented growth globally.</div>`,
    );
    const para = doc.querySelector('.para') as HTMLElement;
    const before = win.getComputedStyle(para).lineHeight;
    expect(before).toBe(`${LINE_HEIGHT * FONT_SIZE_PX}px`);

    appendTranslation(para);

    // The bug: the appended <font> made the :has() test fail, so the div lost
    // the override and fell back to the book default ("normal").
    expect(win.getComputedStyle(para).lineHeight).toBe(before);
  });

  test('keeps line spacing on a <div> that also holds inline markup and links', () => {
    // Mirrors the real reported paragraph: <i> and <a> children plus the
    // appended translation wrapper.
    const { doc, win } = renderSection(
      `<div class="para">Veganism is <i>experiencing</i> unprecedented ` +
        `<a href="#x">growth</a> globally.</div>`,
    );
    const para = doc.querySelector('.para') as HTMLElement;
    const before = win.getComputedStyle(para).lineHeight;
    expect(before).toBe(`${LINE_HEIGHT * FONT_SIZE_PX}px`);

    appendTranslation(para);

    expect(win.getComputedStyle(para).lineHeight).toBe(before);
  });

  test('keeps line spacing for a book that uses <font> markup of its own', () => {
    // Same root cause without translation involved at all: an EPUB that styles
    // runs with <font> would lose the paragraph overrides.
    const { doc, win } = renderSection(
      `<div class="para">A <font color="red">red</font> word.</div>`,
    );
    const para = doc.querySelector('.para') as HTMLElement;
    expect(win.getComputedStyle(para).lineHeight).toBe(`${LINE_HEIGHT * FONT_SIZE_PX}px`);
  });

  test('keeps line spacing when the translation carries preserved inline markup', () => {
    // Markup round-tripped for #1582 lands inside the source paragraph, and
    // :has() inspects *all* descendants — so the sanitizer's allowlist has to
    // stay a subset of the layout allowlist or formatting re-breaks layout.
    const { doc, win } = renderSection(
      `<div class="para">Veganism is <i>really</i> growing.</div>`,
    );
    const para = doc.querySelector('.para') as HTMLElement;
    const before = win.getComputedStyle(para).lineHeight;

    const fragment = doc.createDocumentFragment();
    fragment.appendChild(doc.createTextNode('素食主义'));
    for (const tag of ['b', 'i', 'em', 'strong', 'u', 'span', 'sup', 'sub', 'small', 'mark']) {
      const marked = doc.createElement(tag);
      marked.textContent = tag;
      fragment.appendChild(marked);
    }
    para.appendChild(
      createTranslationTargetNode({
        content: fragment,
        lang: 'zh',
        targetBlockClassName: 'translation-target-block',
        hidden: false,
        widthLineBreak: false,
      }),
    );

    expect(win.getComputedStyle(para).lineHeight).toBe(before);
  });

  test('keeps line spacing while the original text is hidden', () => {
    const { doc, win } = renderSection(`<div class="para">Veganism is growing.</div>`);
    const para = doc.querySelector('.para') as HTMLElement;
    const before = win.getComputedStyle(para).lineHeight;

    appendTranslation(para);
    setSourceVisibility(para, false);

    expect(para.querySelector('[cfi-skip]')).not.toBeNull();
    expect(win.getComputedStyle(para).lineHeight).toBe(before);
  });

  test('still ignores a <div> that contains a real block child', () => {
    // The rule must keep excluding container divs — only inline formatting
    // descendants qualify a div as paragraph-like.
    const { doc, win } = renderSection(
      `<div class="para">Wrapper<div>an actual block child</div></div>`,
    );
    const para = doc.querySelector('.para') as HTMLElement;
    expect(win.getComputedStyle(para).lineHeight).not.toBe(`${LINE_HEIGHT * FONT_SIZE_PX}px`);
  });
});
