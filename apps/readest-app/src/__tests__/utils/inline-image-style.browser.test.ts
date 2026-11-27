import { describe, test, expect, afterEach } from 'vitest';

import { applyImageStyle, getStyles, ThemeCode } from '@/utils/style';
import { ViewSettings } from '@/types/book';
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

// An image next to text is taken for a glyph standing in for a character and
// clamped to 1em. A title image the book sizes as a share of the line, like
// `<h1><img class="p"/>收音机</h1>` with `.p { width: 30% }`, was clamped too
// and shrank to an icon (#7039).
const settings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
} as ViewSettings;

const themeCode = {
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

const SQUARE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>',
)}`;

const added: Element[] = [];

// The book's CSS first, then the reader's, as the paginator injects them
const render = async (bookCss: string, html: string, layout: Partial<ViewSettings> = {}) => {
  for (const css of [bookCss, getStyles({ ...settings, ...layout }, themeCode)]) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    added.push(style);
  }
  const container = document.createElement('div');
  container.style.width = '600px';
  container.innerHTML = html;
  document.body.appendChild(container);
  added.push(container);
  const img = container.querySelector('img')!;
  await img.decode();
  applyImageStyle(document);
  return img;
};

describe('images inline with text', () => {
  afterEach(() => {
    for (const el of added.splice(0)) el.remove();
  });

  test.each([
    ['default layout', {}],
    ['Override Book Layout', { overrideLayout: true }],
    ['Use Book Layout', { useBookLayout: true }],
  ])('a title image with a percentage width keeps its size under %s (#7039)', async (_, layout) => {
    const img = await render(
      '.p { width: 30%; height: auto; }',
      `<h1 style="font-size: 20px"><img class="p" src="${SQUARE}"/>收音机</h1>`,
      layout,
    );

    expect(img.getBoundingClientRect().height).toBeCloseTo(180, 0);
  });

  test('a title image with a calc() percentage width keeps its size', async () => {
    const img = await render(
      '.p { width: calc(30% - 1px); height: auto; }',
      `<h1 style="font-size: 20px"><img class="p" src="${SQUARE}"/>收音机</h1>`,
    );

    expect(img.getBoundingClientRect().height).toBeCloseTo(179, 0);
  });

  test('a glyph image next to text is still clamped to 1em', async () => {
    const img = await render('', `<p style="font-size: 20px">生<img src="${SQUARE}"/>字</p>`);

    expect(img.classList.contains('has-text-siblings')).toBe(true);
    expect(img.getBoundingClientRect().height).toBeCloseTo(20, 0);
  });

  // The paginator puts an inline object-fit on every image. A post's footer
  // lays out an icon and its count in a div; since #7437 counted the count's
  // span as text, the icon was taken for an image with a caption, made a block
  // and pushed above its count.
  test('an icon stays on the line of the count in a sibling span', async () => {
    const icon = await render(
      `.contain1 { display: flex; justify-content: space-between; align-items: center; }
       .item { display: block; flex: 1; margin: 0 auto; text-align: center; }
       .calibre7 { height: auto; width: 1em; max-width: 20px; margin: 0 0.5em -0.1em 0; }
       .c6 { font-size: 0.8em; }`,
      `<div class="contain1" style="font-size: 20px">${['1944', '945', '1022']
        .map(
          (n) =>
            `<div class="item"><img style="object-fit: contain" class="calibre7" src="${SQUARE}"/><span class="c6">${n}</span></div>`,
        )
        .join('')}</div>`,
    );
    const count = icon.nextElementSibling!.getBoundingClientRect();
    const box = icon.getBoundingClientRect();

    expect(getComputedStyle(icon).display).toBe('inline');
    expect(box.bottom).toBeGreaterThan(count.top);
    expect(box.top).toBeLessThan(count.bottom);
    expect(box.right).toBeLessThanOrEqual(count.left);
  });

  test('an image beside bare text in a div is still laid out as a block', async () => {
    const img = await render(
      '',
      `<div style="font-size: 20px"><img style="object-fit: contain" src="${SQUARE}"/>说明</div>`,
    );

    expect(img.classList.contains('has-text-siblings')).toBe(true);
    expect(getComputedStyle(img).display).toBe('block');
    expect(img.getBoundingClientRect().height).toBeCloseTo(200, 0);
  });
});
