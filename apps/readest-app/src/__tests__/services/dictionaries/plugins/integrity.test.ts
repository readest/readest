import { describe, expect, test } from 'vitest';
import {
  computePluginDictionaryContentId,
  sha256File,
} from '@/services/dictionaries/plugins/integrity';

describe('plugin dictionary integrity', () => {
  test('hashes the complete source with incremental SHA-256', async () => {
    const file = new File(['abc'], 'dict.zip');
    await expect(sha256File(file, 1)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('derives stable content identity from plugin, format, and canonical source manifest', () => {
    const first = computePluginDictionaryContentId('readest.yomitan', 'yomitan', [
      { name: 'b.zip', byteSize: 2, sha256: 'b'.repeat(64) },
      { name: 'a.zip', byteSize: 1, sha256: 'a'.repeat(64) },
    ]);
    const reordered = computePluginDictionaryContentId('readest.yomitan', 'yomitan', [
      { name: 'a.zip', byteSize: 1, sha256: 'a'.repeat(64) },
      { name: 'b.zip', byteSize: 2, sha256: 'b'.repeat(64) },
    ]);
    expect(first).toBe(reordered);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
  });
});
