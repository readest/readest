import { describe, it, expect, afterEach } from 'vitest';
import { buildSectionTextModel, applyGlosses, clearGlosses } from '@/app/reader/utils/wordlensRuby';

afterEach(() => {
  document.body.innerHTML = '';
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
});
