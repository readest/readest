import { describe, expect, test } from 'vitest';
import { isBookDataFileKey } from '@/utils/bookDataKey';

describe('isBookDataFileKey', () => {
  test('matches only keys with a folder under the book hash', () => {
    expect(isBookDataFileKey('u1/Readest/Books/abc/tts/3-f00.mp3')).toBe(true);
    expect(isBookDataFileKey('u1/Readest/Books/abc/tts/3-f00.json')).toBe(true);
    expect(isBookDataFileKey('u1/Readest/Books/abc/Title.epub')).toBe(false);
    expect(isBookDataFileKey('u1/Readest/Books/abc/cover.png')).toBe(false);
    expect(isBookDataFileKey('u1/Readest/Books/abc123.epub')).toBe(false);
    expect(isBookDataFileKey('u1/Readest/Replicas/font/x/a.ttf')).toBe(false);
  });
});
