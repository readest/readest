import { describe, expect, it, vi } from 'vitest';

import { MAX_CHAPTERS, readMp4Chapters } from '@/services/audiobook/mp4Chapters';

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const u8 = (value: number) => Uint8Array.of(value);
const u16 = (value: number) => Uint8Array.of(value >> 8, value & 0xff);
const u32 = (value: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
};
const u64 = (value: number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value));
  return out;
};
const ascii = (text: string) => new TextEncoder().encode(text);
const utf16be = (text: string) =>
  concat(Uint8Array.of(0xfe, 0xff), ...[...text].map((char) => u16(char.charCodeAt(0))));
const box = (type: string, ...payload: Uint8Array[]) => {
  const body = concat(...payload);
  return concat(u32(8 + body.length), ascii(type), body);
};
const fullBox = (type: string, version: number, ...payload: Uint8Array[]) =>
  box(type, u8(version), new Uint8Array(3), ...payload);

const ftyp = box('ftyp', ascii('M4B '), u32(0), ascii('M4B isom'));
const free = box('free', new Uint8Array(24));
const tkhd = (trackId: number, version: 0 | 1 = 0) =>
  version === 1
    ? fullBox('tkhd', 1, u64(0), u64(0), u32(trackId), u32(0))
    : fullBox('tkhd', 0, u32(0), u32(0), u32(trackId), u32(0));
const mdhd = (timeScale: number, version: 0 | 1 = 0) =>
  version === 1
    ? fullBox('mdhd', 1, u64(0), u64(0), u32(timeScale), u64(0))
    : fullBox('mdhd', 0, u32(0), u32(0), u32(timeScale), u32(0));
const hdlr = (handler: string) => fullBox('hdlr', 0, u32(0), ascii(handler), new Uint8Array(12));
const chapRef = (...trackIds: number[]) => box('tref', box('chap', ...trackIds.map(u32)));
const stts = (runs: [count: number, delta: number][]) =>
  fullBox(
    'stts',
    0,
    u32(runs.length),
    ...runs.flatMap(([count, delta]) => [u32(count), u32(delta)]),
  );
const stsz = (sizes: number[]) => fullBox('stsz', 0, u32(0), u32(sizes.length), ...sizes.map(u32));
const stszFixed = (size: number, count: number) => fullBox('stsz', 0, u32(size), u32(count));
/** Builds a large stsz without spreading one argument per entry. */
const stszBulk = (count: number, size: number) => {
  const entries = new Uint8Array(count * 4);
  const view = new DataView(entries.buffer);
  for (let i = 0; i < count; i++) view.setUint32(i * 4, size);
  return fullBox('stsz', 0, u32(0), u32(count), entries);
};
const stsc = (runs: [firstChunk: number, samplesPerChunk: number][]) =>
  fullBox(
    'stsc',
    0,
    u32(runs.length),
    ...runs.flatMap(([first, perChunk]) => [u32(first), u32(perChunk), u32(1)]),
  );
const stco = (offsets: number[], declared = offsets.length) =>
  fullBox('stco', 0, u32(declared), ...offsets.map(u32));
const co64 = (offsets: number[]) => fullBox('co64', 0, u32(offsets.length), ...offsets.map(u64));

const textTrak = (
  tables: Uint8Array[],
  { trackId = 2, version = 0 as 0 | 1, handler = 'text' as string | null, timeScale = 1_000 } = {},
) =>
  box(
    'trak',
    tkhd(trackId, version),
    box(
      'mdia',
      mdhd(timeScale, version),
      ...(handler ? [hdlr(handler)] : []),
      box('minf', box('stbl', ...tables)),
    ),
  );
const audioTrak = ({
  trackId = 1,
  refs = [2],
  version = 0 as 0 | 1,
  handler = 'soun',
  tables = [] as Uint8Array[],
} = {}) =>
  box(
    'trak',
    tkhd(trackId, version),
    ...(refs.length ? [chapRef(...refs)] : []),
    box(
      'mdia',
      mdhd(44_100, version),
      hdlr(handler),
      ...(tables.length ? [box('minf', box('stbl', ...tables))] : []),
    ),
  );
const neroChpl = (entries: [start: number, title: string][]) =>
  fullBox(
    'chpl',
    1,
    u32(0),
    u8(entries.length),
    ...entries.flatMap(([start, title]) => [u64(start), u8(title.length), ascii(title)]),
  );

// Two samples share the first chunk and the third has its own, so sample
// offsets depend on stsc; the stts run of two exercises count > 1.
const samples = [
  concat(u16(15), ascii('Opening Credits')),
  concat(u16(9), ascii('Chapter 1')),
  concat(u16(20), utf16be('Chapter 2')),
];
const audioBytes = new Uint8Array(1_000).fill(0xaa);
const mdatPayload = concat(audioBytes, samples[0]!, samples[1]!, audioBytes, samples[2]!);
const mdat = box('mdat', mdatPayload);
const chunkOffsetsIn = (mdatStart: number) => {
  const first = mdatStart + 8 + audioBytes.length;
  return [first, first + samples[0]!.length + samples[1]!.length + audioBytes.length];
};
const defaultTables = (chunkOffsets: number[], chunkBox = stco) => [
  stts([
    [1, 5_000],
    [2, 30_000],
  ]),
  stsz(samples.map((sample) => sample.length)),
  stsc([
    [1, 2],
    [2, 1],
  ]),
  chunkBox(chunkOffsets),
];

/** Assembles ftyp + mdat + moov, with moov's chunk offsets pointing into mdat. */
const buildFile = (
  moovFor: (chunkOffsets: number[]) => Uint8Array<ArrayBuffer>,
  { layout = 'moov-at-end' as 'moov-at-end' | 'faststart', lead = new Uint8Array(0) } = {},
) => {
  const head = concat(lead, ftyp);
  if (layout === 'moov-at-end') {
    return new Blob([head, mdat, moovFor(chunkOffsetsIn(head.length))]);
  }
  const moovLength = moovFor([0, 0]).length;
  return new Blob([head, moovFor(chunkOffsetsIn(head.length + moovLength)), mdat]);
};
const chapterTrackMoov = (chunkOffsets: number[]) =>
  box('moov', audioTrak(), textTrak(defaultTables(chunkOffsets)));

const expectedTrackChapters = [
  { title: 'Opening Credits', start: 0, timeScale: 1_000 },
  { title: 'Chapter 1', start: 5_000, timeScale: 1_000 },
  { title: 'Chapter 2', start: 35_000, timeScale: 1_000 },
];

describe('readMp4Chapters', () => {
  it('reads the QuickTime chapter track when moov sits after mdat', async () => {
    await expect(readMp4Chapters(buildFile(chapterTrackMoov))).resolves.toEqual(
      expectedTrackChapters,
    );
  });

  it('reads the QuickTime chapter track when moov precedes mdat', async () => {
    await expect(
      readMp4Chapters(buildFile(chapterTrackMoov, { layout: 'faststart' })),
    ).resolves.toEqual(expectedTrackChapters);
  });

  it('finds moov when padding precedes ftyp', async () => {
    await expect(readMp4Chapters(buildFile(chapterTrackMoov, { lead: free }))).resolves.toEqual(
      expectedTrackChapters,
    );
  });

  it('reads 64-bit chunk offsets', async () => {
    const file = buildFile((offsets) =>
      box('moov', audioTrak(), textTrak(defaultTables(offsets, co64))),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual(expectedTrackChapters);
  });

  it('reads version 1 tkhd and mdhd headers', async () => {
    const file = buildFile((offsets) =>
      box('moov', audioTrak({ version: 1 }), textTrak(defaultTables(offsets), { version: 1 })),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual(expectedTrackChapters);
  });

  it('accepts a chapter track that omits hdlr', async () => {
    const file = buildFile((offsets) =>
      box('moov', audioTrak(), textTrak(defaultTables(offsets), { handler: null })),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual(expectedTrackChapters);
  });

  it('reads a fixed-size sample table', async () => {
    const fixed = [concat(u16(9), ascii('Chapter 1')), concat(u16(9), ascii('Chapter 2'))];
    const payload = concat(audioBytes, ...fixed);
    const tables = (offsets: number[]) => [
      stts([[2, 10_000]]),
      stszFixed(fixed[0]!.length, 2),
      stsc([[1, 2]]),
      stco(offsets),
    ];
    const moovFor = (offsets: number[]) => box('moov', audioTrak(), textTrak(tables(offsets)));
    const moovLength = moovFor([0]).length;
    const start = ftyp.length + 8 + audioBytes.length;
    const file = new Blob([ftyp, box('mdat', payload), moovFor([start])]);
    expect(moovLength).toBeGreaterThan(0);

    await expect(readMp4Chapters(file)).resolves.toEqual([
      { title: 'Chapter 1', start: 0, timeScale: 1_000 },
      { title: 'Chapter 2', start: 10_000, timeScale: 1_000 },
    ]);
  });

  it('clamps a corrupt chunk-offset count instead of throwing', async () => {
    const file = buildFile((offsets) =>
      box(
        'moov',
        audioTrak(),
        textTrak([
          stts([
            [1, 5_000],
            [2, 30_000],
          ]),
          stsz(samples.map((sample) => sample.length)),
          stsc([
            [1, 2],
            [2, 1],
          ]),
          stco(offsets, 0xffffffff),
        ]),
      ),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual(expectedTrackChapters);
  });

  it('keeps the chapters it could decode when one sample is unreadable', async () => {
    const file = buildFile((offsets) =>
      box(
        'moov',
        audioTrak(),
        textTrak([
          stts([
            [1, 5_000],
            [1, 30_000],
          ]),
          // The second sample declares a zero length, so it cannot be decoded.
          stsz([samples[0]!.length, 0]),
          stsc([[1, 2]]),
          stco([offsets[0]!]),
        ]),
      ),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual([
      { title: 'Opening Credits', start: 0, timeScale: 1_000 },
      { title: '', start: 5_000, timeScale: 1_000 },
    ]);
  });

  it.each<{ name: string; runs: [number, number][] }>([
    {
      name: 'zero samples per chunk',
      runs: [
        [1, 0],
        [2, 3],
      ],
    },
    {
      name: 'zero first chunk',
      runs: [
        [0, 1],
        [1, 3],
      ],
    },
    {
      name: 'duplicate first chunks',
      runs: [
        [1, 1],
        [1, 2],
      ],
    },
    {
      name: 'descending first chunks',
      runs: [
        [2, 1],
        [1, 2],
      ],
    },
    {
      name: 'first chunk beyond the chunk table',
      runs: [
        [1, 1],
        [0xffffffff, 1],
      ],
    },
  ])('falls back to Nero chapters for $name', async ({ runs }) => {
    const file = buildFile((offsets) =>
      box(
        'moov',
        audioTrak(),
        textTrak([
          stts([[3, 5_000]]),
          stsz(samples.map((sample) => sample.length)),
          stsc(runs),
          stco(offsets),
        ]),
        box('udta', neroChpl([[0, 'Prelude']])),
      ),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual([
      { title: 'Prelude', start: 0, timeScale: 10_000_000 },
    ]);
  });

  it('stops inspecting chunk runs once all declared samples have offsets', async () => {
    const runs: [number, number][] = Array.from({ length: 100 }, (_, i) => [i + 1, 1]);
    const table = stsc(runs);
    const file = buildFile((offsets) =>
      box(
        'moov',
        audioTrak(),
        textTrak([
          stts([[1, 5_000]]),
          stsz([samples[0]!.length]),
          table,
          stco(Array.from({ length: runs.length }, () => offsets[0]!)),
        ]),
      ),
    );
    let tableReads = 0;
    const getUint32 = DataView.prototype.getUint32;
    const spy = vi.spyOn(DataView.prototype, 'getUint32').mockImplementation(function (
      this: DataView,
      offset: number,
      littleEndian?: boolean,
    ) {
      if (this.byteLength === table.length - 8) tableReads++;
      return getUint32.call(this, offset, littleEndian);
    });
    try {
      await expect(readMp4Chapters(file)).resolves.toEqual([expectedTrackChapters[0]]);
      expect(tableReads).toBeLessThan(10);
    } finally {
      spy.mockRestore();
    }
  });

  it('caps a runaway chapter count', async () => {
    const many = Array.from({ length: MAX_CHAPTERS + 20 }, (_, i) =>
      concat(u16(2), ascii(`C${i}`)),
    );
    const payload = concat(...many);
    const start = ftyp.length + 8;
    const moov = box(
      'moov',
      audioTrak(),
      textTrak([
        stts([[many.length, 1_000]]),
        stsz(many.map((sample) => sample.length)),
        stsc([[1, many.length]]),
        stco([start]),
      ]),
    );
    const file = new Blob([ftyp, box('mdat', payload), moov]);

    await expect(readMp4Chapters(file)).resolves.toHaveLength(MAX_CHAPTERS);
  });

  it('reads Nero chpl chapters in 100ns units', async () => {
    const file = new Blob([
      ftyp,
      box('mdat', audioBytes),
      box(
        'moov',
        audioTrak({ refs: [] }),
        box(
          'udta',
          neroChpl([
            [0, 'Prelude'],
            [125_000_000, 'Chapter 1'],
          ]),
        ),
      ),
    ]);

    await expect(readMp4Chapters(file)).resolves.toEqual([
      { title: 'Prelude', start: 0, timeScale: 10_000_000 },
      { title: 'Chapter 1', start: 125_000_000, timeScale: 10_000_000 },
    ]);
  });

  it('falls back to chpl when the chapter track yields no titles', async () => {
    const chpl = box('udta', neroChpl([[0, 'Prelude']]));
    const file = buildFile(() =>
      box(
        'moov',
        audioTrak(),
        textTrak([
          stts([[1, 5_000]]),
          stsz([samples[0]!.length]),
          stsc([[1, 1]]),
          // Offset past the end of the file, as a stale table would be.
          stco([0xfffffff]),
        ]),
        chpl,
      ),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual([
      { title: 'Prelude', start: 0, timeScale: 10_000_000 },
    ]);
  });

  it('ignores a chapter reference that points at an audio track', async () => {
    const file = buildFile((offsets) =>
      box(
        'moov',
        // The reference names the audio track itself rather than the text track.
        audioTrak({ refs: [1], tables: defaultTables(offsets) }),
        box('udta', neroChpl([[0, 'Prelude']])),
      ),
    );

    await expect(readMp4Chapters(file)).resolves.toEqual([
      { title: 'Prelude', start: 0, timeScale: 10_000_000 },
    ]);
  });

  it('reads only the boxes it needs, not the whole moov', async () => {
    // A long book's audio track carries a sample table for every frame.
    const bigTables = [
      stts([[50_000, 1_024]]),
      stszBulk(50_000, 400),
      stsc([[1, 50_000]]),
      stco([0]),
    ];
    const moovFor = (offsets: number[]) =>
      box('moov', audioTrak({ tables: bigTables }), textTrak(defaultTables(offsets)));
    const blob = buildFile(moovFor);
    let bytesRead = 0;
    const counting = {
      size: blob.size,
      slice: (start: number, end: number) => {
        const part = blob.slice(start, end);
        return {
          arrayBuffer: async () => {
            const buffer = await part.arrayBuffer();
            bytesRead += buffer.byteLength;
            return buffer;
          },
        };
      },
    } as unknown as Blob;

    await expect(readMp4Chapters(counting)).resolves.toEqual(expectedTrackChapters);
    expect(blob.size).toBeGreaterThan(200_000);
    expect(bytesRead).toBeLessThan(16_000);
  });

  it('returns no chapters for files that are not MP4', async () => {
    const mp3 = new Blob([ascii('ID3'), u8(4), new Uint8Array(64)]);

    await expect(readMp4Chapters(mp3)).resolves.toEqual([]);
  });
});
