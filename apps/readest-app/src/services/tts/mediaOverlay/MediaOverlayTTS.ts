// Narration-driven stand-in for foliate's `TTS` text iterator.
//
// The controller drives playback by asking its TTS instance for the SSML of the
// current block and stepping with next/prev (block) and nextMark/prevMark (one
// unit). This class answers those calls from the SMIL par list instead of an
// Intl.Segmenter walk, so recorded narration reuses the whole playback loop —
// transport, highlighting, timeline, media session — unchanged.
//
// Semantics deliberately mirror `TTS` in packages/foliate-js/tts.js: marks step
// within a block and spill into the adjacent one at its edges, `paused`
// navigation highlights without producing audio, and an exhausted list returns
// undefined so the controller moves to the next section.

import type { MediaOverlaySection, NarrationPar } from './MediaOverlaySection';

const textFractionAt = (outer: Range, target: Range): number => {
  try {
    const outerDoc = outer.startContainer.ownerDocument ?? outer.startContainer;
    const targetDoc = target.startContainer.ownerDocument ?? target.startContainer;
    if (outerDoc !== targetDoc) return 0;
    const relation = outer.comparePoint(target.startContainer, target.startOffset);
    if (relation < 0) return 0;
    if (relation > 0) return 1;
    const total = outer.toString().length;
    if (total <= 0) return 0;
    const prefix = outer.cloneRange();
    prefix.setEnd(target.startContainer, target.startOffset);
    return Math.min(Math.max(prefix.toString().length / total, 0), 1);
  } catch {
    return 0;
  }
};

const textRangeAt = (outer: Range, fraction: number): Range => {
  const doc = outer.startContainer.ownerDocument!;
  const root = doc.body ?? outer.commonAncestorContainer;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; start: number; end: number }[] = [];
  let total = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!outer.intersectsNode(text)) continue;
    const start = text === outer.startContainer ? outer.startOffset : 0;
    const end = text === outer.endContainer ? outer.endOffset : text.length;
    if (end <= start) continue;
    segments.push({ node: text, start, end });
    total += end - start;
  }

  if (!segments.length || total <= 0) return outer.cloneRange();
  let offset = Math.min(Math.max(fraction, 0), 1) * total;
  for (const segment of segments) {
    const length = segment.end - segment.start;
    if (offset < length) {
      const start = segment.start + Math.floor(offset);
      const range = doc.createRange();
      range.setStart(segment.node, start);
      range.setEnd(segment.node, Math.min(start + 1, segment.end));
      return range;
    }
    offset -= length;
  }

  const last = segments.at(-1)!;
  const range = doc.createRange();
  range.setStart(last.node, Math.max(last.start, last.end - 1));
  range.setEnd(last.node, last.end);
  return range;
};

export class MediaOverlayTTS {
  readonly doc: Document;
  highlight: (range: Range) => void;
  #section: MediaOverlaySection;
  #blockIndex = -1;
  #lastMark: string | null = null;
  #pendingStartPosition: number | null = null;
  #playbackProgress = 0;

  constructor(doc: Document, section: MediaOverlaySection, highlight: (range: Range) => void) {
    this.doc = doc;
    this.#section = section;
    this.highlight = highlight;
  }

  get section(): MediaOverlaySection {
    return this.#section;
  }

  #block(index: number): NarrationPar[] | undefined {
    return this.#section.blocks[index];
  }

  #enter(blockIndex: number, mark: string | null, paused?: boolean): string | undefined {
    const block = this.#block(blockIndex);
    if (!block?.length) return undefined;
    this.#blockIndex = blockIndex;
    this.#lastMark = mark;
    this.#pendingStartPosition = null;
    this.#playbackProgress = 0;
    if (paused) {
      const par = mark ? this.#section.parByMark(mark) : block[0];
      if (par) this.highlight(par.range.cloneRange());
    }
    return this.#section.ssmlForBlock(blockIndex, mark);
  }

  start(): string | undefined {
    return this.#enter(0, null);
  }

  resume(): string | undefined {
    if (this.#blockIndex < 0) return this.start();
    return this.#section.ssmlForBlock(this.#blockIndex, this.#lastMark);
  }

  next(paused?: boolean): string | undefined {
    return this.#enter(this.#blockIndex + 1, null, paused);
  }

  prev(paused?: boolean): string | undefined {
    if (this.#blockIndex <= 0) return undefined;
    return this.#enter(this.#blockIndex - 1, null, paused);
  }

  nextMark(paused?: boolean): string | undefined {
    const block = this.#block(this.#blockIndex);
    const index =
      block && this.#lastMark ? block.findIndex((p) => p.markName === this.#lastMark) : -1;
    if (block && index >= 0 && index < block.length - 1) {
      return this.#enter(this.#blockIndex, block[index + 1]!.markName, paused);
    }
    const nextBlock = this.#block(this.#blockIndex + 1);
    if (!nextBlock?.length) return undefined;
    return this.#enter(this.#blockIndex + 1, nextBlock[0]!.markName, paused);
  }

  prevMark(paused?: boolean): string | undefined {
    const block = this.#block(this.#blockIndex);
    const index =
      block && this.#lastMark ? block.findIndex((p) => p.markName === this.#lastMark) : -1;
    if (block && index > 0) {
      return this.#enter(this.#blockIndex, block[index - 1]!.markName, paused);
    }
    const prevBlock = this.#block(this.#blockIndex - 1);
    if (!prevBlock?.length) return undefined;
    return this.#enter(this.#blockIndex - 1, prevBlock.at(-1)!.markName, paused);
  }

  // Called as each clip becomes audible. Returns the live range (not a clone),
  // as foliate does, because the controller round-trips it through a CFI and
  // matches it against the timeline.
  setMark(mark: string): Range | undefined {
    const par = this.#section.parByMark(mark);
    if (!par) return undefined;
    if (this.#lastMark !== mark) this.#playbackProgress = 0;
    this.#blockIndex = par.blockIndex;
    this.#lastMark = mark;
    this.highlight(par.range.cloneRange());
    return par.range;
  }

  getLastRange(): Range | undefined {
    if (!this.#lastMark) return undefined;
    return this.#section.parByMark(this.#lastMark)?.range.cloneRange();
  }

  // The one-character text location corresponding to the active recording
  // position. Exact Media Overlays retain their publisher-authored par range;
  // chapter-only pairings use a linear text/audio estimate for navigation.
  getPlaybackRange(progress?: number | null): Range | undefined {
    if (!this.#lastMark) return undefined;
    const par = this.#section.parByMark(this.#lastMark);
    if (!par) return undefined;
    if (this.#section.textTiming === 'exact') return par.range.cloneRange();
    if (progress !== null && progress !== undefined && Number.isFinite(progress)) {
      this.#playbackProgress = Math.min(Math.max(progress, 0), 1);
    }
    return textRangeAt(par.range, this.#playbackProgress);
  }

  takeStartPosition(): number | null {
    const position = this.#pendingStartPosition;
    this.#pendingStartPosition = null;
    return position;
  }

  // Resume at the par a location falls inside: the first one still running at
  // the target, so seeking into the middle of a narrated unit replays that unit
  // rather than skipping to the next.
  //
  // Compares against each par's END rather than its start, which makes the
  // result independent of whether the incoming range is anchored on a text node
  // or on an element — a selection and a CFI-resolved anchor differ there, and
  // an element boundary sorts before the text inside it.
  from(range: Range): string | undefined {
    // The caller's range can belong to another section's document: narration
    // skips unnarrated sections, so the location playback was requested from is
    // often not in the section we landed on, and comparing boundary points
    // across documents throws WrongDocumentError. Start from the top instead.
    const rangeDoc = range.startContainer.ownerDocument ?? range.startContainer;
    if (rangeDoc !== this.doc) return this.start();

    const pars = this.#section.pars;
    // END_TO_START compares this range's START against the argument's END.
    const target =
      pars.find((par) => range.compareBoundaryPoints(Range.END_TO_START, par.range) < 0) ??
      pars.at(-1);
    // Unlike foliate's `from`, this leaves #lastMark pointing at the resolved
    // par so a later resume() picks up there instead of the block start.
    if (!target) return this.#enter(0, null);
    const ssml = this.#enter(target.blockIndex, target.markName);
    if (this.#section.textTiming === 'approximate') {
      const fraction = textFractionAt(target.range, range);
      this.#playbackProgress = fraction;
      this.#pendingStartPosition = (target.clipEnd - target.clipBegin) * fraction;
    }
    return ssml;
  }
}
