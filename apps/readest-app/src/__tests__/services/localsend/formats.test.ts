import { describe, expect, it } from 'vitest';
import { partitionSupportedFiles } from '@/services/localsend/formats';
import type { LocalSendFile } from '@/services/localsend/types';

const file = (id: string, fileName: string): LocalSendFile => ({
  id,
  fileName,
  size: 1,
  fileType: 'application/octet-stream',
  preview: null,
});

describe('partitionSupportedFiles', () => {
  it('accepts book formats and skips everything else', () => {
    const { supported, skipped } = partitionSupportedFiles([
      file('1', 'novel.epub'),
      file('2', 'PHOTO.JPG'),
      file('3', 'comic.CBZ'),
      file('4', 'notes.md'),
      file('5', 'archive.tar.gz'),
      file('6', 'noextension'),
    ]);
    expect(supported.map((f) => f.id)).toEqual(['1', '3', '4']);
    expect(skipped.map((f) => f.id)).toEqual(['2', '5', '6']);
  });

  it('handles an empty list', () => {
    const { supported, skipped } = partitionSupportedFiles([]);
    expect(supported).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
