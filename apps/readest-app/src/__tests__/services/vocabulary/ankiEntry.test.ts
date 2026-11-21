// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ENTRY_LENGTH, entryHtml, lookupEntry } from '@/services/vocabulary/ankiEntry';
import type { DictionaryProvider } from '@/services/dictionaries/types';

const render = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
};

describe('entryHtml', () => {
  it('keeps the formatting a card can show, with headings as bold lines', () => {
    expect(
      entryHtml(
        render(
          '<h3>spice</h3><ol><li><b>n.</b> <i>a</i> drug</li><li>flavour<sup>1</sup></li></ol>',
        ),
      ),
    ).toBe(
      '<p><b>spice</b></p><ol><li><b>n.</b> <i>a</i> drug</li><li>flavour<sup>1</sup></li></ol>',
    );
  });

  it("drops what can't work in Anki: scripts, styles, media, links and attributes", () => {
    expect(
      entryHtml(
        render(
          '<style>.x{}</style><script>alert(1)</script>' +
            '<div class="def" style="color:red" onclick="x()">a <a href="entry://other">drug</a></div>' +
            '<img src="blob:abc"><audio src="blob:def"></audio><button>Play</button>',
        ),
      ),
    ).toBe('<div>a drug</div>');
  });

  it('keeps the content of tags it does not know, without the tags', () => {
    expect(entryHtml(render('<entry><gram>n.</gram> a drug</entry>'))).toBe('n. a drug');
  });

  it("takes an MDict entry out of its shadow root, without the root's stylesheet", () => {
    const div = document.createElement('div');
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>b{color:red}</style><div part="dict-content"><b>Haus</b> house</div>';
    div.append(host);
    expect(entryHtml(div)).toBe('<div><div><b>Haus</b> house</div></div>');
  });

  it('stops at a block boundary once the entry is long enough', () => {
    const sense = `<p>${'x'.repeat(MAX_ENTRY_LENGTH / 3)}</p>`;
    const html = entryHtml(render(sense.repeat(5)));
    expect(html.length).toBeLessThanOrEqual(MAX_ENTRY_LENGTH);
    expect(html).toBe(sense.repeat(2));
  });

  it('cuts a long list after its last whole item', () => {
    const item = `<li>${'y'.repeat(MAX_ENTRY_LENGTH / 4)}</li>`;
    expect(entryHtml(render(`<p>senses</p><ol>${item.repeat(6)}</ol>`))).toBe(
      `<p>senses</p><ol>${item.repeat(3)}</ol>`,
    );
  });

  it('keeps the start of a first block too long to fit whole', () => {
    expect(entryHtml(render(`<div>${'x'.repeat(MAX_ENTRY_LENGTH + 1)}</div>`))).toBe(
      `<div>${'x'.repeat(MAX_ENTRY_LENGTH - '<div></div>'.length)}</div>`,
    );
    // Escaped characters count at their escaped length, and none is cut in half.
    const html = entryHtml(render(`<p>${'&amp;'.repeat(MAX_ENTRY_LENGTH)}</p>`));
    expect(html.length).toBeLessThanOrEqual(MAX_ENTRY_LENGTH);
    expect(html).toMatch(/^<p>(&amp;)+<\/p>$/);
  });

  it('cuts a long first block after leading whitespace too', () => {
    expect(entryHtml(render(`\n<div>${'x'.repeat(MAX_ENTRY_LENGTH + 1)}</div>`))).toBe(
      `\n<div>${'x'.repeat(MAX_ENTRY_LENGTH - '\n<div></div>'.length)}</div>`,
    );
  });

  it('stops when wrappers alone use up the length', () => {
    const depth = Math.ceil(MAX_ENTRY_LENGTH / '<blockquote></blockquote>'.length) + 1;
    const html = `${'<blockquote>'.repeat(depth)}x${'</blockquote>'.repeat(depth)}`;
    expect(entryHtml(render(html))).toBe('');
  });

  it('is empty for an entry with no text', () => {
    expect(entryHtml(render('<div><img src="a.png"></div>'))).toBe('');
  });
});

describe('lookupEntry', () => {
  const provider = (html: string | null): DictionaryProvider => ({
    id: 'stardict:x',
    kind: 'stardict',
    label: 'X',
    lookup: async (_word, ctx) => {
      if (html === null) return { ok: false, reason: 'empty' };
      ctx.container.innerHTML = html;
      return { ok: true };
    },
  });

  it("is the cleaned entry of the reader's dictionary", async () => {
    await expect(lookupEntry('spice', 'en', provider('<p>a <a>drug</a></p>'))).resolves.toBe(
      '<p>a drug</p>',
    );
  });

  afterEach(() => vi.useRealTimers());

  it('gives up on a dictionary that does not answer, and cancels its request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const stalled: DictionaryProvider = {
      ...provider(''),
      lookup: (_word, ctx) => {
        signal = ctx.signal;
        return new Promise(() => {});
      },
    };
    const entry = lookupEntry('spice', 'en', stalled);
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(entry).resolves.toBe('');
    expect(signal?.aborted).toBe(true);
  });

  it('is empty when the dictionary has no entry or fails', async () => {
    await expect(lookupEntry('spice', 'en', provider(null))).resolves.toBe('');
    const broken = { ...provider(''), lookup: () => Promise.reject(new Error('io')) };
    await expect(lookupEntry('spice', 'en', broken)).resolves.toBe('');
  });
});
