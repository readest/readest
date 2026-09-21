// MP4 chapters live in one of two places, and music-metadata reads neither of
// them reliably:
//
// - A QuickTime chapter track, where the audio track points at a text track
//   whose samples hold the titles. music-metadata pulls those titles out only
//   while it streams past mdat, and only once it has parsed the tracks in
//   moov, so a file that stores moov after the audio (what ffmpeg writes
//   without -movflags +faststart) yields no chapters and no error. Tracked
//   upstream as Borewit/music-metadata#2510.
// - A Nero chpl list in moov/udta, which music-metadata does not read at all.
//
// This reader finds moov wherever it sits, prefers the chapter track and falls
// back to chpl. It walks box headers straight off the file and reads only the
// handful of small boxes it needs, so a long book's per-frame sample tables are
// never pulled into memory.
//
// Every length here comes from the file, so each table's declared entry count
// is clamped to what its own box can hold, and a box that fails to parse leaves
// the other chapter source a chance to work.

export interface Mp4Chapter {
  title: string;
  start: number;
  timeScale: number;
}

/** Offsets are absolute positions in the file. */
interface Box {
  type: string;
  start: number;
  headerSize: number;
  end: number;
}

/** Enough for the largest box header (64-bit size). */
const HEADER_BYTES = 16;
/** No real audiobook has more; a larger count means a table we misread. */
export const MAX_CHAPTERS = 1_000;
/** Chapter titles are short; anything larger is a bad sample size. */
const MAX_TITLE_BYTES = 64 * 1_024;
/** Upper bound on a single box payload we are willing to buffer. */
const MAX_BOX_BYTES = 8 * 1_024 * 1_024;
/** Nero chapter start times are in 100ns units. */
const NERO_TIME_SCALE = 10_000_000;

const readView = async (file: Blob, start: number, end: number) =>
  new DataView(await file.slice(start, end).arrayBuffer());

const parseHeader = (view: DataView, start: number, limit: number): Box | null => {
  if (view.byteLength < 8) return null;
  let size = view.getUint32(0);
  let headerSize = 8;
  if (size === 1) {
    if (view.byteLength < 16) return null;
    size = Number(view.getBigUint64(8));
    headerSize = 16;
  } else if (size === 0) {
    size = limit - start;
  }
  if (size < headerSize || start + size > limit) return null;
  const type = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + 4, 4));
  if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
  return { type, start, headerSize, end: start + size };
};

const readHeader = async (file: Blob, start: number, limit: number) =>
  parseHeader(await readView(file, start, Math.min(start + HEADER_BYTES, limit)), start, limit);

async function* childBoxes(file: Blob, parent: Box) {
  let at = parent.start + parent.headerSize;
  while (at + 8 <= parent.end) {
    const box = await readHeader(file, at, parent.end);
    if (!box) return;
    yield box;
    at = box.end;
  }
}

const findChild = async (file: Blob, parent: Box, type: string) => {
  for await (const child of childBoxes(file, parent)) if (child.type === type) return child;
  return undefined;
};

const findPath = async (file: Blob, parent: Box, path: string[]) => {
  let box: Box | undefined = parent;
  for (const type of path) {
    if (!box) return undefined;
    box = await findChild(file, box, type);
  }
  return box;
};

/** Reads a box's payload, refusing one whose declared length is implausible. */
const payloadView = async (file: Blob, box: Box) => {
  const start = box.start + box.headerSize;
  if (box.end - start > MAX_BOX_BYTES) return null;
  return readView(file, start, box.end);
};

const findTopLevelBox = async (file: Blob, type: string) => {
  for (let at = 0; at + 8 <= file.size; ) {
    const box = await readHeader(file, at, file.size);
    if (!box) return undefined;
    if (box.type === type) return box;
    at = box.end;
  }
  return undefined;
};

/** How many entries a table box can actually hold, whatever it claims. */
const tableCapacity = (view: DataView, headerBytes: number, width: number) =>
  Math.max(0, Math.floor((view.byteLength - headerBytes) / width));

// --- QuickTime chapter track: audio trak -> tref/chap -> text trak samples ---

// tkhd and mdhd both put the field we want after version/flags and two
// timestamps, which are 32-bit in version 0 and 64-bit in version 1.
const fieldAfterTimestamps = (payload: DataView) =>
  payload.getUint32(payload.getUint8(0) === 1 ? 20 : 12);

/** Writers that omit hdlr are accepted; one that claims another kind is not. */
const isTextTrack = async (file: Blob, trak: Box) => {
  const hdlr = await findPath(file, trak, ['mdia', 'hdlr']);
  if (!hdlr) return true;
  const view = await payloadView(file, hdlr);
  if (!view || view.byteLength < 12) return true;
  const handler = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + 8, 4));
  return handler === 'text' || handler === 'sbtl';
};

const findChapterTrack = async (file: Blob, traks: Box[]) => {
  const trackIds = await Promise.all(
    traks.map(async (trak) => {
      const tkhd = await findChild(file, trak, 'tkhd');
      const view = tkhd ? await payloadView(file, tkhd) : null;
      return view && view.byteLength >= 16 ? fieldAfterTimestamps(view) : undefined;
    }),
  );
  for (const trak of traks) {
    const chap = await findPath(file, trak, ['tref', 'chap']);
    const view = chap ? await payloadView(file, chap) : null;
    if (!view) continue;
    for (let at = 0; at + 4 <= view.byteLength; at += 4) {
      const target = traks[trackIds.indexOf(view.getUint32(at))];
      // A track referencing itself is a broken file, not a chapter list.
      if (target && target !== trak && (await isTextTrack(file, target))) return target;
    }
  }
  return undefined;
};

/** A title sample is a 16-bit length followed by the text itself. */
const decodeChapterText = (sample: DataView) => {
  if (sample.byteLength < 2) return '';
  const length = Math.min(sample.getUint16(0), sample.byteLength - 2);
  const bytes = new Uint8Array(sample.buffer, sample.byteOffset + 2, length);
  const utf16 = bytes[0] === 0xfe && bytes[1] === 0xff;
  return new TextDecoder(utf16 ? 'utf-16be' : 'utf-8').decode(bytes);
};

/** An unreadable sample costs one title, not the whole chapter list. */
const readTitle = async (file: Blob, offset: number, size: number) => {
  if (size < 2 || size > MAX_TITLE_BYTES) return '';
  return decodeChapterText(await readView(file, offset, offset + size));
};

const readChapterTrack = async (file: Blob, trak: Box): Promise<Mp4Chapter[]> => {
  const mdhd = await findPath(file, trak, ['mdia', 'mdhd']);
  const stbl = await findPath(file, trak, ['mdia', 'minf', 'stbl']);
  if (!mdhd || !stbl) return [];
  const tables = new Map<string, Box>();
  for await (const child of childBoxes(file, stbl)) tables.set(child.type, child);
  const chunkBox = tables.get('stco') ?? tables.get('co64');
  const sttsBox = tables.get('stts');
  const stszBox = tables.get('stsz');
  const stscBox = tables.get('stsc');
  if (!chunkBox || !sttsBox || !stszBox || !stscBox) return [];

  const [mdhdView, sttsView, stszView, stscView, chunkView] = await Promise.all([
    payloadView(file, mdhd),
    payloadView(file, sttsBox),
    payloadView(file, stszBox),
    payloadView(file, stscBox),
    payloadView(file, chunkBox),
  ]);
  if (!mdhdView || !sttsView || !stszView || !stscView || !chunkView) return [];
  if (mdhdView.byteLength < 16 || stszView.byteLength < 12) return [];

  const fixedSize = stszView.getUint32(4);
  const declared = stszView.getUint32(8);
  const sampleCount = Math.min(
    declared,
    MAX_CHAPTERS,
    fixedSize ? declared : tableCapacity(stszView, 12, 4),
  );
  const sizeOf = (sample: number) => fixedSize || stszView.getUint32(12 + sample * 4);

  const width = chunkBox.type === 'co64' ? 8 : 4;
  const chunkCount = Math.min(chunkView.getUint32(4), tableCapacity(chunkView, 8, width));
  const chunkOffsets = Array.from({ length: chunkCount }, (_, index) =>
    width === 8
      ? Number(chunkView.getBigUint64(8 + index * 8))
      : chunkView.getUint32(8 + index * 4),
  );

  // Expand the sample-to-chunk runs into a file offset per sample.
  const offsets: number[] = [];
  const chunkRuns = Math.min(stscView.getUint32(4), tableCapacity(stscView, 8, 12));
  for (let run = 0; run < chunkRuns && offsets.length < sampleCount; run++) {
    const at = 8 + run * 12;
    const firstChunk = stscView.getUint32(at);
    const samplesPerChunk = stscView.getUint32(at + 4);
    const nextFirstChunk = run + 1 < chunkRuns ? stscView.getUint32(at + 12) : chunkCount + 1;
    if (
      samplesPerChunk === 0 ||
      firstChunk < 1 ||
      nextFirstChunk <= firstChunk ||
      nextFirstChunk > chunkCount + 1
    ) {
      return [];
    }
    for (let chunk = firstChunk; chunk < nextFirstChunk && offsets.length < sampleCount; chunk++) {
      let offset = chunkOffsets[chunk - 1];
      if (offset === undefined) break;
      for (let i = 0; i < samplesPerChunk && offsets.length < sampleCount; i++) {
        offsets.push(offset);
        offset += sizeOf(offsets.length - 1);
      }
    }
  }

  // Expand the time-to-sample runs into a start time per sample. These are the
  // chapter track's own media times; an edit list (elst) that shifts the track
  // is ignored, as it is by music-metadata's reader.
  const starts: number[] = [];
  const timeRuns = Math.min(sttsView.getUint32(4), tableCapacity(sttsView, 8, 8));
  let time = 0;
  for (let run = 0; run < timeRuns && starts.length < sampleCount; run++) {
    const at = 8 + run * 8;
    const count = sttsView.getUint32(at);
    const delta = sttsView.getUint32(at + 4);
    for (let i = 0; i < count && starts.length < sampleCount; i++) {
      starts.push(time);
      time += delta;
    }
  }

  const timeScale = fieldAfterTimestamps(mdhdView);
  const chapters: Mp4Chapter[] = [];
  for (let i = 0; i < Math.min(offsets.length, starts.length); i++) {
    const title = await readTitle(file, offsets[i]!, sizeOf(i));
    chapters.push({ title, start: starts[i]!, timeScale });
  }
  return chapters;
};

// --- Nero chapters: a flat list in moov/udta/chpl with the titles inline ---

const readNeroChapters = async (file: Blob, chpl: Box): Promise<Mp4Chapter[]> => {
  const view = await payloadView(file, chpl);
  if (!view || view.byteLength < 5) return [];
  // Version 1 adds a reserved 32-bit field before the count.
  let at = view.getUint8(0) ? 8 : 4;
  if (at >= view.byteLength) return [];
  const count = Math.min(view.getUint8(at), MAX_CHAPTERS);
  at += 1;
  const chapters: Mp4Chapter[] = [];
  for (let i = 0; i < count && at + 9 <= view.byteLength; i++) {
    const length = view.getUint8(at + 8);
    if (at + 9 + length > view.byteLength) break;
    const title = new TextDecoder().decode(
      new Uint8Array(view.buffer, view.byteOffset + at + 9, length),
    );
    chapters.push({ title, start: Number(view.getBigUint64(at)), timeScale: NERO_TIME_SCALE });
    at += 9 + length;
  }
  return chapters;
};

/**
 * Reads chapters wherever moov sits in the file, preferring a QuickTime
 * chapter track and falling back to a Nero `chpl` list. Returns an empty list
 * for files that are not MP4.
 */
export const readMp4Chapters = async (file: Blob): Promise<Mp4Chapter[]> => {
  const moov = await findTopLevelBox(file, 'moov');
  if (!moov) return [];

  const traks: Box[] = [];
  for await (const box of childBoxes(file, moov)) {
    if (box.type === 'trak') traks.push(box);
  }
  const chapterTrack = await findChapterTrack(file, traks);
  // A malformed sample table must not hide a usable chpl list.
  const trackChapters = chapterTrack
    ? await readChapterTrack(file, chapterTrack).catch(() => [])
    : [];

  if (trackChapters.some((chapter) => chapter.title)) return trackChapters;

  const chpl = await findPath(file, moov, ['udta', 'chpl']);
  if (!chpl) return trackChapters;
  const neroChapters = await readNeroChapters(file, chpl).catch(() => []);
  return neroChapters.length ? neroChapters : trackChapters;
};
