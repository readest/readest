import { describe, it, expect } from 'vitest';
import { md5, fullMD5 } from '@/utils/md5';

describe('fullMD5', () => {
  it('hashes the whole file', async () => {
    expect(await fullMD5(new File(['hello world'], 'a.txt'))).toBe(
      '5eb63bbbe01eeed093cb22bb8f5acdc3',
    );
  });

  it('hashes a file larger than one chunk in order', async () => {
    const bytes = new Uint8Array(5 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    expect(await fullMD5(new File([bytes], 'big.epub'))).toBe(md5(bytes));
  });
});
