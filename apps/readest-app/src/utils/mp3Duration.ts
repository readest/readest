// Reading an MP3's duration from its first few KB instead of the whole file.
//
// OPDS carries no duration metadata, so the audiobook timeline has to get it
// from the audio itself. Asking a media element means downloading each track in
// full on a server that ignores Range -- 284 MB before the first second of a
// 12-part audiobook is audible. Every field needed is in the first frame
// header, so a few KB and the Content-Length answer the same question (#6224).

/** MPEG audio version, from the 2 version bits. */
const MPEG1 = 3;
const MPEG2 = 2;
const MPEG25 = 0;

// Layer III bitrates in kbps, indexed by the header's 4 bitrate bits.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] as const;
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0] as const;

const SAMPLE_RATES: Record<number, readonly number[]> = {
  [MPEG1]: [44100, 48000, 32000, 0],
  [MPEG2]: [22050, 24000, 16000, 0],
  [MPEG25]: [11025, 12000, 8000, 0],
};

/** Layer III decodes this many samples per frame; MPEG2/2.5 use the short form. */
const samplesPerFrame = (version: number): number => (version === MPEG1 ? 1152 : 576);

/** Total size of an ID3v2 tag at the start of the buffer, 0 when there is none. */
export const id3TagSize = (buf: Uint8Array): number => {
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return 0;
  // Synchsafe integer: 7 significant bits per byte.
  const size =
    ((buf[6]! & 0x7f) << 21) |
    ((buf[7]! & 0x7f) << 14) |
    ((buf[8]! & 0x7f) << 7) |
    (buf[9]! & 0x7f);
  const hasFooter = (buf[5]! & 0x10) !== 0;
  return 10 + size + (hasFooter ? 10 : 0);
};

interface FrameHeader {
  offset: number;
  version: number;
  bitrateBps: number;
  sampleRate: number;
  mono: boolean;
}

/**
 * The first valid Layer III frame header at or after `from`.
 *
 * Scans rather than trusting the ID3 size: tags with bad size fields, or
 * padding between the tag and the first frame, are common enough in
 * user-supplied audio that a fixed offset misses the frame outright.
 */
const findFrameHeader = (buf: Uint8Array, from: number): FrameHeader | null => {
  for (let i = from; i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) continue;

    const version = (buf[i + 1]! >> 3) & 0x03;
    const layer = (buf[i + 1]! >> 1) & 0x03;
    // version 1 is reserved; layer 01 is the only one we decode.
    if (version === 1 || layer !== 1) continue;

    const bitrateIndex = (buf[i + 2]! >> 4) & 0x0f;
    const sampleRateIndex = (buf[i + 2]! >> 2) & 0x03;
    const table = version === MPEG1 ? BITRATES_V1 : BITRATES_V2;
    const bitrateKbps = table[bitrateIndex] ?? 0;
    const sampleRate = SAMPLE_RATES[version]?.[sampleRateIndex] ?? 0;
    if (!bitrateKbps || !sampleRate) continue;

    return {
      offset: i,
      version,
      bitrateBps: bitrateKbps * 1000,
      sampleRate,
      mono: ((buf[i + 3]! >> 6) & 0x03) === 3,
    };
  }
  return null;
};

/**
 * Frame count from a Xing (VBR) or Info (CBR) tag, or 0 when absent. The tag
 * sits in the first frame's side-information area, whose size depends on the
 * version and channel mode.
 */
const xingFrameCount = (buf: Uint8Array, frame: FrameHeader): number => {
  const sideInfo = frame.version === MPEG1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const at = frame.offset + 4 + sideInfo;
  if (at + 12 > buf.length) return 0;

  const tag = String.fromCharCode(buf[at]!, buf[at + 1]!, buf[at + 2]!, buf[at + 3]!);
  if (tag !== 'Xing' && tag !== 'Info') return 0;

  const flags = (buf[at + 4]! << 24) | (buf[at + 5]! << 16) | (buf[at + 6]! << 8) | buf[at + 7]!;
  if (!(flags & 0x01)) return 0; // no frame-count field

  return ((buf[at + 8]! << 24) | (buf[at + 9]! << 16) | (buf[at + 10]! << 8) | buf[at + 11]!) >>> 0;
};

/**
 * Duration in seconds from the head of an MP3 plus its total byte length, or
 * NaN when the bytes don't describe one.
 *
 * Prefers the Xing/Info frame count, which is exact for VBR too; otherwise
 * assumes the first frame's bitrate holds for the file, which is what makes
 * the estimate good for the constant-bitrate encodes audiobooks ship as.
 */
export const parseMp3Duration = (head: Uint8Array, totalBytes: number): number => {
  if (!head?.length || !Number.isFinite(totalBytes) || totalBytes <= 0) return NaN;

  const tagSize = id3TagSize(head);
  const frame = findFrameHeader(head, Math.min(tagSize, head.length));
  if (!frame) return NaN;

  const frames = xingFrameCount(head, frame);
  if (frames > 0) return (frames * samplesPerFrame(frame.version)) / frame.sampleRate;

  const audioBytes = totalBytes - frame.offset;
  if (audioBytes <= 0) return NaN;
  return (audioBytes * 8) / frame.bitrateBps;
};
