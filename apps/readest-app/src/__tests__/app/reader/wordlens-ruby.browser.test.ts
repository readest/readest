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

  // #7332: a word ending where its text node ends (`<i>word</i> `, `word<sup>`)
  // was dropped because its end offset resolved into the next text node.
  it('glosses a word that ends at an element boundary', () => {
    document.body.innerHTML =
      `<p id="a">amet, <i>kañ</i> God</p>` +
      `<p id="b">labore <i>highlight</i> magna</p>` +
      `<p id="c">this word: footnote<sup><a>1</a></sup></p>`;
    const model = buildSectionTextModel(document);
    const occ = ['kañ', 'highlight', 'footnote'].map((word) => {
      const start = model.text.indexOf(word);
      return { start, end: start + word.length, word, gloss: 'g' };
    });
    applyGlosses(document, model, occ);

    const glossed = [...document.querySelectorAll('ruby.wl-gloss')].map(
      (r) => r.firstChild?.textContent,
    );
    expect(glossed).toEqual(['kañ', 'highlight', 'footnote']);
    expect(document.getElementById('a')!.textContent).toBe('amet, kañg God');
    expect(document.getElementById('c')!.textContent).toBe('this word: footnoteg1');
  });

  it('finds the base word for a tap inside a gloss', () => {
    document.body.innerHTML = `<p>The quick fox</p>`;
    const model = buildSectionTextModel(document);
    applyGlosses(document, model, [{ start: 4, end: 9, word: 'quick', gloss: '敏捷' }]);
    const rt = document.querySelector('rt')!;
    expect(findGlossWord(rt as unknown as HTMLElement)).toBe('quick');
  });
});
