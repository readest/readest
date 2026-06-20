import { describe, it, expect } from 'vitest';

import { dataUrlToBytes, imageExtensionFromMime } from '@/utils/image';

describe('dataUrlToBytes', () => {
  it('decodes a base64 data URL into bytes and its MIME type', () => {
    // base64 "AAEC" -> bytes [0, 1, 2]
    const { bytes, mimeType } = dataUrlToBytes('data:image/png;base64,AAEC');
    expect(mimeType).toBe('image/png');
    expect(Array.from(bytes)).toEqual([0, 1, 2]);
  });

  it('decodes a non-base64 (percent-encoded) data URL', () => {
    const { bytes, mimeType } = dataUrlToBytes('data:image/svg+xml,%3Csvg%2F%3E');
    expect(mimeType).toBe('image/svg+xml');
    expect(new TextDecoder().decode(bytes)).toBe('<svg/>');
  });

  it('throws on a value that is not a data URL', () => {
    expect(() => dataUrlToBytes('blob:whatever')).toThrow();
  });
});

describe('imageExtensionFromMime', () => {
  it('maps common image MIME types to file extensions', () => {
    expect(imageExtensionFromMime('image/png')).toBe('png');
    expect(imageExtensionFromMime('image/jpeg')).toBe('jpg');
    expect(imageExtensionFromMime('image/webp')).toBe('webp');
    expect(imageExtensionFromMime('image/gif')).toBe('gif');
  });

  it('strips structured-syntax suffixes (svg+xml -> svg)', () => {
    expect(imageExtensionFromMime('image/svg+xml')).toBe('svg');
  });
});
