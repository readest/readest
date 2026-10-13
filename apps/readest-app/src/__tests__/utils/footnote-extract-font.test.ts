import { describe, it, expect } from 'vitest';
import { extractToBody } from 'foliate-js/footnotes.js';

// A popup shows a note's contents straight in the body, so the element the
// book styled the note through is gone. Sigil/Duokan templates set the note
// font on exactly that element (#3602).
describe('footnote extraction', () => {
  it('keeps the font the book gives the note element', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.head.innerHTML = `<style>
      body { font-family: BodyFont; }
      li.duokan-footnote-item { font-family: "NoteFont"; }
    </style>`;
    doc.body.innerHTML = `<p>Text<a href="#n1">1</a></p>
      <ol class="duokan-footnote-content">
        <li class="duokan-footnote-item" id="n1"><a href="#r1">⊙</a>注：a note.</li>
      </ol>`;
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById('n1')!);

    extractToBody(doc, range);

    expect(doc.body.textContent).toBe('⊙注：a note.');
    expect(doc.defaultView!.getComputedStyle(doc.body).fontFamily).toBe('"NoteFont"');
    iframe.remove();
  });
});
