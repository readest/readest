import { describe, it, expect } from 'vitest';
import {
  extractSourcePayload,
  sanitizeTranslatedMarkup,
  splitMarkupIntoChunks,
} from '@/app/reader/utils/translationMarkup';
import { splitTextIntoChunks } from '@/services/translators/utils';

const el = (html: string): HTMLElement => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

const html = (fragment: DocumentFragment | null) => {
  if (!fragment) return null;
  const host = document.createElement('div');
  host.appendChild(fragment);
  return host.innerHTML;
};

describe('extractSourcePayload', () => {
  it('reports plain text as having no markup', () => {
    const payload = extractSourcePayload(el('Veganism is growing.'));
    expect(payload.hasMarkup).toBe(false);
    expect(payload.html).toBe('');
    expect(payload.text).toBe('Veganism is growing.');
  });

  it('serializes inline markup and collects its attributes', () => {
    const payload = extractSourcePayload(el('A <span class="whisper">hush</span> fell.'));
    expect(payload.hasMarkup).toBe(true);
    expect(payload.html).toBe('A <span class="whisper">hush</span> fell.');
    expect(payload.allowedAttrs.has('span|class|whisper')).toBe(true);
  });

  it('never sends previously injected translation targets back to the translator', () => {
    const source = el('Original text.');
    const target = document.createElement('font');
    target.className = 'translation-target';
    target.textContent = '译文';
    source.appendChild(target);

    const payload = extractSourcePayload(source);
    expect(payload.text).toBe('Original text.');
    expect(payload.text).not.toContain('译文');
  });

  it('drops a11y skip links', () => {
    const source = el('Real prose.<span cfi-inert="">Skip to next section</span>');
    expect(extractSourcePayload(source).text).toBe('Real prose.');
  });

  it('keeps WordLens base text but drops the injected reading', () => {
    const source = el('The <ruby class="wl-gloss">辞書<rt>じしょ</rt></ruby> is open.');
    const payload = extractSourcePayload(source);
    expect(payload.text).toBe('The 辞書 is open.');
    expect(payload.text).not.toContain('じしょ');
  });
});

describe('sanitizeTranslatedMarkup', () => {
  const allow = (...keys: string[]) => new Set(keys);

  it('keeps allowlisted inline tags', () => {
    const out = sanitizeTranslatedMarkup('那只<b>敏捷</b>的狐狸', allow());
    expect(html(out)).toBe('那只<b>敏捷</b>的狐狸');
  });

  it('unwraps disallowed tags but keeps their text', () => {
    const out = sanitizeTranslatedMarkup('a<div>b</div><p>c</p>', allow());
    expect(html(out)).toBe('abc');
  });

  it('drops script elements and their content is not executed as markup', () => {
    const out = sanitizeTranslatedMarkup('safe<script>alert(1)</script>', allow());
    expect(html(out)).not.toContain('<script');
  });

  it('drops event handlers, style and unexpected attributes', () => {
    const out = sanitizeTranslatedMarkup(
      '<span onclick="alert(1)" style="color:red" id="x">hi</span>',
      allow(),
    );
    expect(html(out)).toBe('<span>hi</span>');
  });

  it('keeps an attribute only when the source echoed that exact value', () => {
    const kept = sanitizeTranslatedMarkup(
      '<span class="whisper">轻声</span>',
      allow('span|class|whisper'),
    );
    expect(html(kept)).toBe('<span class="whisper">轻声</span>');

    const dropped = sanitizeTranslatedMarkup(
      '<span class="injected">轻声</span>',
      allow('span|class|whisper'),
    );
    expect(html(dropped)).toBe('<span>轻声</span>');
  });

  it('refuses a javascript: href the source never contained', () => {
    const out = sanitizeTranslatedMarkup(
      '<a href="javascript:alert(1)">click</a>',
      allow('a|href|#chapter2'),
    );
    expect(html(out)).toBe('<a>click</a>');
  });

  it('normalizes unbalanced tags rather than leaking them into the DOM', () => {
    const out = sanitizeTranslatedMarkup('start <i>unclosed italic', allow());
    expect(html(out)).toBe('start <i>unclosed italic</i>');
  });

  it('preserves nested inline markup', () => {
    const out = sanitizeTranslatedMarkup('<b>粗<i>斜</i></b>', allow());
    expect(html(out)).toBe('<b>粗<i>斜</i></b>');
  });

  it('returns null when nothing meaningful survives, so callers can fall back', () => {
    expect(sanitizeTranslatedMarkup('', allow())).toBeNull();
    expect(sanitizeTranslatedMarkup('<script>alert(1)</script>', allow())).toBeNull();
  });

  it('only emits tags the paragraph-layout rule tolerates', () => {
    // A <sup> is allowlisted; a <div> is not and must be unwrapped, otherwise
    // preserved markup would make the enclosing source div lose its layout.
    const out = sanitizeTranslatedMarkup('x<sup>1</sup><div>y</div>', allow());
    expect(html(out)).toBe('x<sup>1</sup>y');
  });
});

describe('splitMarkupIntoChunks', () => {
  const split = (html: string, max: number) =>
    splitMarkupIntoChunks(html, max, splitTextIntoChunks);

  /** Text of an HTML string, as the browser would render it. */
  const textOf = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.textContent ?? '';
  };

  it('returns a single chunk when the markup already fits', () => {
    const html = 'A <b>bold</b> claim.';
    expect(split(html, 1000)).toEqual([html]);
  });

  it('keeps every chunk within the budget', () => {
    const html = `Sentence one is here. <i>Emphasised middle part.</i> ` + 'Tail text. '.repeat(40);
    const chunks = split(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
  });

  it('loses no text across the split', () => {
    const html = `Intro text here. <i>${'italic words '.repeat(20)}</i>then <b>bold</b> tail.`;
    const chunks = split(html, 150);
    expect(chunks.join('').length).toBeGreaterThan(0);
    expect(textOf(chunks.join(''))).toBe(textOf(html));
  });

  it('produces chunks that are each well-formed on their own', () => {
    const html = `Start <i>${'long italic run '.repeat(20)}</i> end.`;
    for (const chunk of split(html, 160)) {
      const host = document.createElement('div');
      host.innerHTML = chunk;
      // Re-serializing a well-formed fragment is a fixed point.
      expect(host.innerHTML).toBe(chunk);
    }
  });

  it('re-opens formatting that straddles a boundary', () => {
    const html = `<i>${'italic sentence here. '.repeat(15)}</i>`;
    const chunks = split(html, 120);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk carries its own <i>, so nothing renders unformatted.
    for (const chunk of chunks) expect(chunk.startsWith('<i>')).toBe(true);
    expect(textOf(chunks.join(''))).toBe(textOf(html));
  });

  it('preserves attributes on every chunk of a split run', () => {
    const html = `<span class="whisper">${'quiet words here. '.repeat(15)}</span>`;
    const chunks = split(html, 130);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk).toContain('class="whisper"');
  });

  it('escapes markup-significant characters in text', () => {
    const chunks = split('5 &lt; 6 &amp; 7 &gt; 6', 1000);
    expect(textOf(chunks.join(''))).toBe('5 < 6 & 7 > 6');
  });

  it('unwraps disallowed tags rather than emitting them', () => {
    const chunks = split('a<div>b</div>c', 1000);
    expect(chunks.join('')).toBe('abc');
  });

  it('gives up when a single tag’s overhead cannot fit, so callers fall back', () => {
    expect(split('<span class="a-very-long-class-name-here">x</span>', 10)).toEqual([]);
  });

  it('handles nested formatting without unbalancing it', () => {
    const html = `<b>bold ${'and '.repeat(30)}<i>then italic</i></b>`;
    const chunks = split(html, 140);
    expect(textOf(chunks.join(''))).toBe(textOf(html));
    for (const chunk of chunks) {
      const host = document.createElement('div');
      host.innerHTML = chunk;
      expect(host.innerHTML).toBe(chunk);
    }
  });
});
