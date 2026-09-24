import { describe, expect, it } from 'vitest';

import { getImageSize } from '@/utils/image';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );
const u16be = (n: number) => [n >> 8, n & 0xff];
const u16le = (n: number) => [n & 0xff, n >> 8];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, n >> 16];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [...u32be(n)].reverse();

const png = (width: number, height: number) =>
  bytes([0x89], 'PNG\r\n\x1a\n', u32be(13), 'IHDR', u32be(width), u32be(height), [8, 6, 0, 0, 0]);

// SOI, then an APP segment of `appLength` bytes (EXIF, ICC and Photoshop
// blocks commonly push the size marker tens of kilobytes in), then SOF0.
const jpeg = (width: number, height: number, appLength = 16) =>
  bytes(
    [0xff, 0xd8, 0xff, 0xe1],
    u16be(appLength),
    new Array(appLength - 2).fill(0x41),
    [0xff, 0xc0],
    u16be(17),
    [8],
    u16be(height),
    u16be(width),
    [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );

describe('getImageSize', () => {
  it('reads PNG', () => {
    expect(getImageSize(png(2200, 1673))).toEqual({ width: 2200, height: 1673 });
  });

  it('reads JPEG past its metadata segments', () => {
    expect(getImageSize(jpeg(1200, 1829))).toEqual({ width: 1200, height: 1829 });
    expect(getImageSize(jpeg(2200, 1673, 30000))).toEqual({ width: 2200, height: 1673 });
  });

  it('reads JPEG with fill bytes before a marker', () => {
    const data = bytes([0xff, 0xd8, 0xff, 0xff], [0xc2], u16be(17), [8], u16be(20), u16be(40));
    expect(getImageSize(data)).toEqual({ width: 40, height: 20 });
  });

  it('reads GIF', () => {
    expect(getImageSize(bytes('GIF89a', u16le(640), u16le(480)))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('reads lossy, lossless and extended WebP', () => {
    const riff = (chunk: string, data: number[]) =>
      bytes('RIFF', u32le(4 + 8 + data.length), 'WEBP', chunk, u32le(data.length), data);
    const vp8 = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(800), ...u16le(600)]);
    expect(getImageSize(vp8)).toEqual({ width: 800, height: 600 });

    const bits = (800 - 1) | ((600 - 1) << 14);
    const vp8l = riff('VP8L', [0x2f, ...u32le(bits)]);
    expect(getImageSize(vp8l)).toEqual({ width: 800, height: 600 });

    const vp8x = riff('VP8X', [0, 0, 0, 0, ...u24le(3000 - 1), ...u24le(2000 - 1)]);
    expect(getImageSize(vp8x)).toEqual({ width: 3000, height: 2000 });
  });

  it('reads BMP, including top-down rows', () => {
    const bmp = (height: number) =>
      bytes('BM', new Array(12).fill(0), u32le(40), u32le(300), u32le(height >>> 0));
    expect(getImageSize(bmp(200))).toEqual({ width: 300, height: 200 });
    expect(getImageSize(bmp(-200))).toEqual({ width: 300, height: 200 });
  });

  it('returns null when the header is cut short or unknown', () => {
    expect(getImageSize(jpeg(2200, 1673, 30000).slice(0, 16 * 1024))).toBeNull();
    expect(getImageSize(png(10, 10).slice(0, 20))).toBeNull();
    expect(getImageSize(bytes('<?xml version="1.0"?><ComicInfo/>'))).toBeNull();
    expect(getImageSize(new Uint8Array())).toBeNull();
  });
});
