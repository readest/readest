import { describe, it, expect, afterEach } from 'vitest';
import {
  buildSectionTextModel,
  applyGlosses,
  clearGlosses,
  findGlossWord,
} from '@/app/reader/utils/wordlensRuby';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('wordlensRuby', () => {
  it('builds a text model whose string matches visible text and locates offsets', () => {
    document.body.innerHTML = `<p id="p">The quick fox</p>`;
    const model = buildSectionTextModel(document);
    expect(model.text).toBe('The quick fox');
    const startLoc = model.locate(4);
    const endLoc = model.locate(9);
    const r = document.createRange();
    r.setStart(startLoc.node, startLoc.offset);
    r.setEnd(endLoc.node, endLoc.offset);
    expect(r.toString()).toBe('quick');
  });

  it('skips text inside existing ruby and rt', () => {
    document.body.innerHTML = `<p>a<ruby>本<rt>もと</rt></ruby>b</p>`;
    const model = buildSectionTextModel(document);
    expect(model.text).toBe('ab');
  });

  it('wraps occurrences as cfi-inert ruby and clears them', () => {
    document.body.innerHTML = `<p id="p">The quick fox</p>`;
    const model = buildSectionTextModel(document);
    applyGlosses(document, model, [{ start: 4, end: 9, word: 'quick', gloss: '敏捷' }]);

    const ruby = document.querySelector('ruby.wl-gloss')!;
    expect(ruby.getAttribute('cfi-skip')).toBe('');
    expect(ruby.querySelector('rt')!.getAttribute('cfi-inert')).toBe('');
    expect(ruby.querySelector('rt')!.textContent).toBe('敏捷');
    expect(document.getElementById('p')!.textContent).toBe('The quick敏捷 fox');

    clearGlosses(document);
    expect(document.querySelector('ruby.wl-gloss')).toBeNull();
    expect(document.getElementById('p')!.textContent).toBe('The quick fox');
  });

  it('finds the base word for a tap inside a gloss', () => {
    document.body.innerHTML = `<p>The quick fox</p>`;
    const model = buildSectionTextModel(document);
    applyGlosses(document, model, [{ start: 4, end: 9, word: 'quick', gloss: '敏捷' }]);
    const rt = document.querySelector('rt')!;
    expect(findGlossWord(rt as unknown as HTMLElement)).toBe('quick');
  });
});
