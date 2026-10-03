/**
 * The MDX header is XML, so its attribute values arrive escaped: OALD9 ships
 * `Title="Oxford Advanced Learner&apos;s Dictionary 9th edition"`. Lifting the
 * raw attribute text into the dictionary name printed the entity verbatim in
 * the lookup sheet's source label (#6018).
 */
import { describe, it, expect, vi } from 'vitest';
import { importDictionaries } from '@/services/dictionaries/dictionaryService';
import type { FileSystem } from '@/types/system';

function createMockFs(): FileSystem {
  return {
    resolvePath: vi
      .fn()
      .mockReturnValue({ baseDir: 0, basePrefix: async () => '', fp: 'x', base: 'Dictionaries' }),
    getURL: vi.fn().mockReturnValue('url'),
    getBlobURL: vi.fn().mockResolvedValue('blob:url'),
    getImageURL: vi.fn().mockResolvedValue('image:url'),
    openFile: vi.fn().mockResolvedValue(new File([], 'unused')),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    readDir: vi.fn().mockResolvedValue([]),
    createDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    stats: vi.fn().mockResolvedValue({
      isFile: true,
      isDirectory: false,
      size: 0,
      mtime: null,
      atime: null,
      birthtime: null,
    }),
    getPrefix: vi.fn().mockResolvedValue('Readest/Dictionaries'),
  };
}

/** An MDX file that carries nothing but the header the importer reads. */
function createMdxFile(xml: string, name = 'oald9.mdx'): File {
  const utf16 = new Uint8Array(xml.length * 2);
  const view = new DataView(utf16.buffer);
  for (let i = 0; i < xml.length; i++) {
    view.setUint16(i * 2, xml.charCodeAt(i), true);
  }
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, utf16.byteLength, false);
  return new File([size, utf16, new Uint8Array(4)], name);
}

describe('importDictionaries — MDX header title', () => {
  it('decodes XML entities in the title (#6018)', async () => {
    const fs = createMockFs();
    const mdx = createMdxFile(
      '<Dictionary GeneratedByEngineVersion="2.0" Encrypted="2" ' +
        'Title="Oxford Advanced Learner&apos;s Dictionary &amp; Thesaurus &#169; 2016" ' +
        'Encoding="UTF-8"/>',
    );

    const result = await importDictionaries(fs, [{ file: mdx }]);

    expect(result.imported).toHaveLength(1);
    const entry = result.imported[0]!;
    expect(entry.kind).toBe('mdict');
    expect(entry.name).toBe("Oxford Advanced Learner's Dictionary & Thesaurus © 2016");
    expect(entry.unsupported).toBeUndefined();
  });
});
