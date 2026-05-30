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
});
