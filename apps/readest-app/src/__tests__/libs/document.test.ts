import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DocumentLoader } from '@/libs/document';

if (typeof globalThis['CSS'] === 'undefined') {
  (globalThis as Record<string, unknown>)['CSS'] = {
    escape: (s: string) => s.replace(/([^\w-])/g, '\\$1'),
  };
}

if (!customElements.get('foliate-paginator')) {
  customElements.define(
    'foliate-paginator',
    class extends HTMLElement {
      override setAttribute() {}
      override addEventListener() {}
      open() {}
    },
  );
}

vi.mock('foliate-js/paginator.js', () => ({}));

const loadFixtureBytes = (name: string): Uint8Array => {
  const epubPath = resolve(__dirname, `../fixtures/data/${name}`);
  return new Uint8Array(readFileSync(epubPath));
};

describe('DocumentLoader.open', () => {
  it('opens an EPUB whose first local file header has a non-standard signature byte', async () => {
    // Some EPUB writers in the wild produce a malformed first local file header
    // signature - PK\x03\x02 instead of the spec-mandated PK\x03\x04.
    // The archive is otherwise valid: zip.js reads every entry via the central
    // directory at the end of the file. We must not reject it at the magic-bytes gate.
    const bytes = loadFixtureBytes('repro-3688.epub');
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const malformed = bytes.slice();
    malformed[3] = 0x02;

    const file = new File([malformed], 'malformed-header.epub', {
      type: 'application/epub+zip',
    });
    const result = await new DocumentLoader(file).open();

    expect(result.book).toBeTruthy();
    expect(result.format).toBe('EPUB');
  }, 15000);

  it('opens a raw .txt by converting it to EPUB in-memory', async () => {
    // The Android "Open with Readest" (VIEW intent) transient path hands the
    // reader the original .txt file (its filePath points at the content:// URI),
    // unlike the managed library which stores the already-converted EPUB. The
    // loader must therefore be able to open a raw .txt directly; otherwise it
    // returns { book: null } and initViewState crashes on `bookDoc.metadata`.
    const txt = [
      'Chapter 1',
      '',
      'It was a bright cold day in April, and the clocks were striking thirteen.',
      '',
      'Chapter 2',
      '',
      'Winston Smith slipped quickly through the glass doors of Victory Mansions.',
    ].join('\n');
    const file = new File([txt], 'my-book.txt', { type: 'text/plain' });

    const result = await new DocumentLoader(file).open();

    expect(result.book).toBeTruthy();
    expect(result.format).toBe('EPUB');
  }, 15000);

  const txtBody = ['Chapter 1', '', 'Hello world.'].join('\n');

  it('opens a .txt whose MIME carries a charset param and whose name lacks the ext', async () => {
    // Android can hand over a content:// URI with no .txt extension and a
    // parameterised MIME (text/plain;charset=utf-8). Strict `=== 'text/plain'`
    // plus a name-only ext check would both miss and yield a null book.
    const file = new File([txtBody], 'content-12345', { type: 'text/plain;charset=utf-8' });

    const result = await new DocumentLoader(file).open();

    expect(result.book).toBeTruthy();
    expect(result.format).toBe('EPUB');
  }, 15000);

  it('opens a .txt with an uppercase extension and a generic MIME', async () => {
    const file = new File([txtBody], 'MY-BOOK.TXT', { type: 'application/octet-stream' });

    const result = await new DocumentLoader(file).open();

    expect(result.book).toBeTruthy();
    expect(result.format).toBe('EPUB');
  }, 15000);
});
