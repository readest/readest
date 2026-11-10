import { describe, it, expect } from 'vitest';
import { isFootnoteBacklink, extractToBody } from 'foliate-js/footnotes.js';

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

describe('isFootnoteBacklink', () => {
  it('returns true for common Japanese and symbolic backlink texts', () => {
    for (const text of [
      '［戻る］',
      '（戻る）',
      '戻る',
      'もどる',
      '（本文へ戻る）',
      '本文へ戻る',
      '解説へ戻る',
      '↩',
      '^',
      '↑',
      '⏎',
      'back',
      'Return',
      'jump back',
    ]) {
      const doc = parseHtml(`<p><a href="#ref">${text}</a></p>`);
      const a = doc.querySelector('a')!;
      expect(isFootnoteBacklink(a)).toBe(true);
    }
  });

  it('returns true for semantic backlink classes, epub:type, and roles', () => {
    const doc = parseHtml(`
      <div>
        <a id="a1" href="#ref" class="footnote-backref">ref</a>
        <a id="a2" href="#ref" class="reversefootnote">1</a>
        <a id="a3" href="#ref" class="backlink">link</a>
        <a id="a4" href="#ref" epub:type="backlink">1</a>
        <a id="a5" href="#ref" role="doc-backlink">1</a>
      </div>
    `);
    expect(isFootnoteBacklink(doc.querySelector('#a1')!)).toBe(true);
    expect(isFootnoteBacklink(doc.querySelector('#a2')!)).toBe(true);
    expect(isFootnoteBacklink(doc.querySelector('#a3')!)).toBe(true);
    expect(isFootnoteBacklink(doc.querySelector('#a4')!)).toBe(true);
    expect(isFootnoteBacklink(doc.querySelector('#a5')!)).toBe(true);
  });

  it('returns false for footnote markers or arbitrary link texts', () => {
    for (const text of ['1', '注1', '（注1）', '＊1', '※', 'Chapter 2', 'Reference link']) {
      const doc = parseHtml(`<p><a href="#ref">${text}</a></p>`);
      const a = doc.querySelector('a')!;
      expect(isFootnoteBacklink(a)).toBe(false);
    }
  });
});

describe('multi-paragraph footnote extraction with trailing backlinks', () => {
  it('includes trailing paragraphs containing return links instead of cutting off', () => {
    const doc = parseHtml(`
      <div class="footnote-area">
        <p id="fn-001"><a id="target-001"></a>1　注釈の概要段落です。</p>
        <p>注釈の詳細な解説段落が続きます。</p>
        <p id="fn-001-end">注釈の最後の段落です。<a href="#ref-001">［戻る］</a></p>
        <p id="fn-002"><a id="target-002"></a>2　次の注釈です。<a href="#ref-002">［戻る］</a></p>
      </div>
    `);

    const el = doc.getElementById('fn-001')!;
    const range = doc.createRange();
    range.setStartBefore(el);

    let next = el.nextElementSibling;
    while (next) {
      const anchors = Array.from(next.querySelectorAll('a'));
      if (anchors.length > 0 && !anchors.every(isFootnoteBacklink)) break;
      next = next.nextElementSibling;
    }

    if (next) {
      range.setEndBefore(next);
    } else {
      range.setEndAfter(el.parentNode!.lastChild!);
    }

    // Range should stop before #fn-002, thus including all 3 paragraphs of #fn-001
    expect(next?.id).toBe('fn-002');
    expect(range.endContainer).toBe(doc.querySelector('.footnote-area'));

    const popupDoc = parseHtml('<!DOCTYPE html><html><body></body></html>');
    extractToBody(popupDoc, range);
    expect(popupDoc.body.textContent).toContain('注釈の概要段落');
    expect(popupDoc.body.textContent).toContain('注釈の詳細な解説段落');
    expect(popupDoc.body.textContent).toContain('注釈の最後の段落');
    expect(popupDoc.body.textContent).not.toContain('次の注釈です');
  });
});
