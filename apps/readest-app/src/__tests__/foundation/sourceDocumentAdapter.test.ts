import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';

const documentOpen = vi.hoisted(() => vi.fn());

vi.mock('@/libs/document', async () => {
  const actual = await vi.importActual<typeof import('@/libs/document')>('@/libs/document');
  return {
    ...actual,
    DocumentLoader: class {
      open = documentOpen;
    },
  };
});

import {
  detectTxtEncoding,
  parseLibrarySourceDocument,
  supportsAiReadingWorkspace,
} from '@/services/foundation/sourceDocumentAdapter';

const book = (format: Book['format'], hash = `hash-${format.toLowerCase()}`): Book => ({
  hash,
  format,
  title: `${format} 测试`,
  author: '',
  createdAt: 1,
  updatedAt: 1,
});

describe('source document adapters', () => {
  beforeEach(() => documentOpen.mockReset());

  it('registers the first-batch source formats only', () => {
    expect(
      ['MD', 'TXT', 'HTML', 'EPUB'].every((format) =>
        supportsAiReadingWorkspace(format as Book['format']),
      ),
    ).toBe(true);
    expect(supportsAiReadingWorkspace('PDF')).toBe(false);
  });

  it('detects a UTF-16 BOM and keeps duplicate TXT paragraphs at distinct source lines', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x0, 0x0a, 0x0, 0x0a, 0x0, 0x2d, 0x4e]);
    expect(detectTxtEncoding(bytes.buffer)).toMatchObject({ encoding: 'utf-16le', confidence: 1 });

    const result = await parseLibrarySourceDocument(
      book('TXT'),
      new File(['重复段落\n\n重复段落'], 'repeat.txt', { type: 'text/plain' }),
    );
    expect(result.document.sourceFormat).toBe('txt');
    expect(result.document.sections[0]).toMatchObject({ title: '正文', generated: true });
    expect(result.document.blocks.map((block) => block.semanticText)).toEqual([
      '重复段落',
      '重复段落',
    ]);
    expect(result.document.blocks.map((block) => block.locator)).toEqual([
      { kind: 'text', startLine: 1 },
      { kind: 'text', startLine: 3 },
    ]);

    const redecoded = await parseLibrarySourceDocument(
      book('TXT'),
      new File(['重复段落\n\n重复段落'], 'repeat.txt', { type: 'text/plain' }),
      { txtEncoding: 'big5' },
    );
    expect(redecoded.document.versionId).toBe(result.document.versionId);
  });

  it('sanitizes HTML, blocks remote images by default, and supports document-level loading', async () => {
    const source = `<!doctype html><title>安全页</title><body>
      <h1>正文</h1><p>可阅读内容</p><script>window.bad = true</script>
      <img src="https://example.com/remote.png" alt="示意图">
      <math><mi>x</mi><mo>+</mo><mi>y</mi></math></body>`;
    const file = new File([source], 'safe.html', { type: 'text/html' });
    const blocked = await parseLibrarySourceDocument(book('HTML'), file, { htmlMode: 'full' });

    expect(blocked.warnings.map((warning) => warning.code)).toContain('remote-images-blocked');
    expect(blocked.document.blocks.some((block) => block.semanticText.includes('window.bad'))).toBe(
      false,
    );
    expect(blocked.document.blocks.some((block) => block.semanticText.includes('公式：x+y'))).toBe(
      true,
    );
    expect(blocked.document.blocks.some((block) => block.sourceText.includes('https://'))).toBe(
      false,
    );

    const allowed = await parseLibrarySourceDocument(book('HTML'), file, {
      htmlMode: 'full',
      allowRemoteImages: true,
    });
    expect(allowed.warnings.map((warning) => warning.code)).not.toContain('remote-images-blocked');
    expect(allowed.document.blocks.some((block) => block.sourceText.includes('remote.png'))).toBe(
      true,
    );
    expect(allowed.document.versionId).toBe(blocked.document.versionId);
  });

  it('bridges reflowable EPUB spine sections to unified blocks and CFI locators', async () => {
    const destroy = vi.fn();
    const sectionDoc = new DOMParser().parseFromString(
      '<!doctype html><title>第一章</title><body><h1>第一章</h1><p>EPUB 正文</p></body>',
      'text/html',
    );
    documentOpen.mockResolvedValue({
      format: 'EPUB',
      book: {
        metadata: { title: '原生 EPUB' },
        rendition: { layout: 'reflowable' },
        sections: [
          {
            linear: 'yes',
            cfi: 'epubcfi(/6/2)',
            createDocument: vi.fn(async () => sectionDoc),
          },
        ],
        destroy,
      },
    });

    const result = await parseLibrarySourceDocument(
      book('EPUB'),
      new File(['epub'], 'book.epub', { type: 'application/epub+zip' }),
    );
    expect(result.document.sourceFormat).toBe('epub');
    expect(result.document.blocks[1]?.locator).toMatchObject({
      kind: 'epub',
      spineIndex: 0,
      sectionCfi: 'epubcfi(/6/2)',
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects fixed-layout EPUBs without entering the text annotation workflow', async () => {
    const destroy = vi.fn();
    documentOpen.mockResolvedValue({
      format: 'EPUB',
      book: {
        metadata: { title: '固定版式' },
        rendition: { layout: 'pre-paginated' },
        sections: [],
        destroy,
      },
    });

    await expect(
      parseLibrarySourceDocument(
        book('EPUB'),
        new File(['epub'], 'fixed.epub', { type: 'application/epub+zip' }),
      ),
    ).rejects.toThrow('固定版式 EPUB');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
