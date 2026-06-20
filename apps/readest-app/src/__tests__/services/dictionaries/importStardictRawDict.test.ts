/**
 * Importer accepts raw (uncompressed) `.dict` bodies, not just `.dict.dz`.
 * The runtime body loader (`loadDictBody`) probes the gzip header and falls
 * through to a passthrough buffer for raw files, so there's no reason to
 * gate the import.
 */
import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'fflate';
import { importDictionaries } from '@/services/dictionaries/dictionaryService';
import {
  IFO_FIXTURE_NAME,
  IDX_FIXTURE_NAME,
  readIfoFile,
  readIdxFile,
  readDictFile,
} from './_stardictFixtures';
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

async function readRawDictFile(): Promise<File> {
  // Inflate the fixture .dict.dz to get a raw .dict body. Same content as
  // what the dictzip-compressed bundle would expand to, but stored without
  // the gzip wrapper — exactly the case this test guards.
  const dz = await readDictFile();
  const dzBytes = new Uint8Array(await dz.arrayBuffer());
  const raw = gunzipSync(dzBytes);
  return new File([new Uint8Array(raw)], 'cmudict.dict');
}

describe('importDictionaries — StarDict raw .dict', () => {
  it('imports a raw .dict bundle without flagging it unsupported', async () => {
    const fs = createMockFs();
    const ifo = await readIfoFile();
    const idx = await readIdxFile();
    const dict = await readRawDictFile();

    const result = await importDictionaries(fs, [{ file: ifo }, { file: idx }, { file: dict }]);

    expect(result.orphanFiles).toEqual([]);
    expect(result.imported).toHaveLength(1);
    const entry = result.imported[0]!;
    expect(entry.kind).toBe('stardict');
    expect(entry.files.dict).toBe('cmudict.dict');
    expect(entry.files.ifo).toBe(IFO_FIXTURE_NAME);
    expect(entry.files.idx).toBe(IDX_FIXTURE_NAME);
    expect(entry.unsupported).toBeUndefined();
    expect(entry.unsupportedReason).toBeUndefined();
  });
});
