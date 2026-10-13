import { describe, expect, it } from 'vitest';
import { parseMp3Duration } from '@/utils/mp3Duration';

// A minimal MPEG1 Layer III, 64 kbps, 44.1 kHz, mono frame header.
//   FF FB  -> sync + MPEG1 + Layer III + no CRC
//   50     -> bitrate index 5 (64 kbps), sample rate index 0 (44100)
//   C0     -> channel mode 11 (mono)
const FRAME = [0xff, 0xfb, 0x50, 0xc0];

/** ID3v2 header declaring `size` bytes of tag body (synchsafe, 7 bits/byte). */
const id3 = (size: number): number[] => [
  0x49,
  0x44,
  0x33,
  0x03,
  0x00,
  0x00,
  (size >> 21) & 0x7f,
  (size >> 14) & 0x7f,
  (size >> 7) & 0x7f,
  size & 0x7f,
];

const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat());

const u32 = (n: number): number[] => [
  (n >> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];

describe('parseMp3Duration', () => {
  it('derives CBR duration from the frame header and file size', () => {
    // 64 kbps over 31,255,480 bytes is the real shape of a LibriVox chapter:
    // 31255480 * 8 / 64000 = 3906.9s, which ffprobe reports as 3906.7s.
    const head = bytes(FRAME, new Array(2048).fill(0));

    const duration = parseMp3Duration(head, 31255480);

    expect(duration).toBeGreaterThan(3890);
    expect(duration).toBeLessThan(3920);
  });

  it('skips an ID3v2 tag before looking for the first frame', () => {
    const tagBody = new Array(500).fill(0);
    const head = bytes(id3(500), tagBody, FRAME, new Array(64).fill(0));

    // The tag bytes must not count towards the audio length.
    const duration = parseMp3Duration(head, 510 + 640000);

    expect(duration).toBeCloseTo(80, 0);
  });

  it('prefers an exact Xing/Info frame count over the CBR estimate', () => {
    // MPEG1 mono puts the Xing tag 21 bytes after the frame header start.
    const pad = new Array(21 - FRAME.length).fill(0);
    // 1000 frames * 1152 samples / 44100 Hz = 26.12s, deliberately unrelated
    // to what the file size would imply.
    const head = bytes(FRAME, pad, [0x49, 0x6e, 0x66, 0x6f], u32(0x0001), u32(1000));

    const duration = parseMp3Duration(head, 99999999);

    expect(duration).toBeCloseTo(26.12, 1);
  });

  it('returns NaN when there is no usable frame header', () => {
    expect(Number.isNaN(parseMp3Duration(new Uint8Array(512), 1000))).toBe(true);
    expect(Number.isNaN(parseMp3Duration(bytes(FRAME), 0))).toBe(true);
  });
});
