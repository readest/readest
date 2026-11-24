import { describe, it, expect, afterEach } from 'vitest';
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

      const baseRect = baseRange.getBoundingClientRect();
      const rtRect = rtRange.getBoundingClientRect();
      const baseCenter = (baseRect.left + baseRect.right) / 2;
      const rtCenter = (rtRect.left + rtRect.right) / 2;
      expect(Math.abs(baseCenter - rtCenter)).toBeLessThanOrEqual(2);
    }
  });
});
