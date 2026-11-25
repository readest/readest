import { describe, it, expect, afterEach } from 'vitest';
import { page } from 'vitest/browser';
import { buildSectionTextModel, applyGlosses, clearGlosses } from '@/app/reader/utils/wordlensRuby';
import { getStyles } from '@/utils/style';
import type { ViewSettings } from '@/types/book';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

const makeViewSettings = (): ViewSettings =>
  ({
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
  }) as ViewSettings;

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('style[data-wordlens-test]').forEach((el) => el.remove());
});

describe('Word Lens rendering (browser)', () => {
  it('renders a gloss above a word and grows line height, then clears cleanly', () => {
    document.body.innerHTML = `<div id="root" style="font-size:16px;line-height:1.2"><p>A cryptic note appears.</p></div>`;
    const root = document.getElementById('root')!;
    const before = root.getBoundingClientRect().height;

    const model = buildSectionTextModel(document);
    const start = model.text.indexOf('cryptic');
    applyGlosses(document, model, [
      { start, end: start + 'cryptic'.length, word: 'cryptic', gloss: '晦涩的' },
    ]);

    const rt = document.querySelector('ruby.wl-gloss > rt')!;
    expect(rt.textContent).toBe('晦涩的');
    expect(root.getBoundingClientRect().height).toBeGreaterThan(before);

    clearGlosses(document);
    expect(document.querySelector('ruby.wl-gloss')).toBeNull();
    expect(root.textContent).toBe('A cryptic note appears.');
  });

  // #7880: Chromium 128+ makes <ruby> line-breakable, so under overflow-wrap:
  // break-word a glossed word near the end of a line split mid-word across
  // lines along with its <rt> hint, and ruby-align: space-around stretched
  // narrow bases with diacritics beneath wider hints.
  it('keeps glossed words unbroken across lines and centered under wide hints (#7880)', () => {
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-wordlens-test', '');
    styleEl.textContent = getStyles(makeViewSettings(), undefined, []);
    document.head.appendChild(styleEl);

    document.body.innerHTML = `<div style="width:420px;font-size:24px;line-height:1.6"><p>Lorem ipsum kañ sit amet, śummqarosyā tempor incididunt <em>śummqarosyā</em>. Lorem ipsum kañ sit amet, īśmana tempor <em>īśmana</em>.</p></div>`;

    const model = buildSectionTextModel(document);
    const occurrences = [];
    for (const [word, gloss] of [
      ['śummqarosyā', 'test'],
      ['īśmana', 'pure incididunt & ipsuma'],
    ] as const) {
      let from = 0;
      for (
        let idx = model.text.indexOf(word, from);
        idx !== -1;
        idx = model.text.indexOf(word, from)
      ) {
        occurrences.push({ start: idx, end: idx + word.length, word, gloss });
        from = idx + word.length;
      }
    }
    applyGlosses(document, model, occurrences);

    const rubies = [...document.querySelectorAll('ruby.wl-gloss')];
    expect(rubies).toHaveLength(4);
    for (const ruby of rubies) {
      const computed = getComputedStyle(ruby);
      expect(computed.whiteSpace).toBe('nowrap');
      expect(computed.rubyAlign).toBe('center');
      const baseRange = document.createRange();
      baseRange.selectNodeContents(ruby.firstChild!);
      const baseLineTops = new Set([...baseRange.getClientRects()].map((r) => Math.round(r.top)));
      expect(baseLineTops.size).toBe(1);

      const rt = ruby.querySelector('rt')!;
      const rtRange = document.createRange();
      rtRange.selectNodeContents(rt.firstChild!);
      const rtLineTops = new Set([...rtRange.getClientRects()].map((r) => Math.round(r.top)));
      expect(rtLineTops.size).toBe(1);
    }
  });

  // #7880: under a hint wider than the word, Chromium centers the word by
  // widening the advance of the last glyph of its first letter. When that
  // letter is a base plus a combining mark (Bitter shapes ī as ı + U+0304),
  // the mark is pushed away from its letter ("ı  ̄śmana"). Compare the word's
  // ink with and without the gloss, with the hint and neighbours transparent.
  it('keeps combining marks on their letters and the word centered under a wider hint (#7880)', async () => {
    const response = await fetch(
      new URL('../../../public/fonts/InterVariable.woff2', import.meta.url),
    );
    const face = new FontFace('WordLensInk', await response.arrayBuffer());
    document.fonts.add(face);
    await face.load();

    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-wordlens-test', '');
    styleEl.textContent = `${getStyles(makeViewSettings(), undefined, [])}
      .ink { font: 40px/3 WordLensInk !important; color: #000 !important; background: #fff; text-align: left !important; }
      .ink .mute, .ink rt { color: transparent !important; opacity: 1 !important; }`;
    document.head.appendChild(styleEl);

    // n + U+0304 has no precomposed form, so every font shapes it as two glyphs.
    const words = ['n\u0304ama', 'aman\u0304'];
    const gloss = 'a hint much wider than its word';
    document.body.innerHTML = words
      .map(
        (word) =>
          `<p class="ink"><span class="mute">xx </span>${word}<span class="mute"> xx</span></p>` +
          `<p class="ink"><span class="mute">xx </span>${word}<span class="mute"> xx</span></p>`,
      )
      .join('');
    const model = buildSectionTextModel(document);
    const second = (word: string) => model.text.indexOf(word, model.text.indexOf(word) + 1);
    applyGlosses(
      document,
      model,
      words.map((word) => ({ start: second(word), end: second(word) + word.length, word, gloss })),
    );
    expect(document.querySelectorAll('ruby.wl-gloss')).toHaveLength(words.length);

    // Left and right edge, in CSS px, of the dark pixels in a paragraph.
    const inkSpan = async (p: HTMLElement) => {
      const base64 = await page.screenshot({ element: p, save: false });
      const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let left = width;
      let right = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4]! < 128) {
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        }
      }
      const scale = width / p.getBoundingClientRect().width;
      const origin = p.getBoundingClientRect().left;
      return { left: origin + left / scale, right: origin + (right + 1) / scale };
    };

    const paragraphs = [...document.querySelectorAll<HTMLElement>('p.ink')];
    for (let i = 0; i < words.length; i++) {
      const plain = await inkSpan(paragraphs[i * 2]!);
      const glossed = await inkSpan(paragraphs[i * 2 + 1]!);
      // The word is drawn whole: its ink is as wide as without the gloss.
      const widthChange = glossed.right - glossed.left - (plain.right - plain.left);
      expect(Math.abs(widthChange), words[i]).toBeLessThanOrEqual(1);

      // And it stays centered under its hint.
      const rtRange = document.createRange();
      rtRange.selectNodeContents(paragraphs[i * 2 + 1]!.querySelector('rt')!);
      const rtRect = rtRange.getBoundingClientRect();
      const inkCenter = (glossed.left + glossed.right) / 2;
      expect(Math.abs(inkCenter - (rtRect.left + rtRect.right) / 2), words[i]).toBeLessThan(2);
    }
    document.fonts.delete(face);
  });
});
