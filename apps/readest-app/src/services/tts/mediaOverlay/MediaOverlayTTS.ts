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

export class MediaOverlayTTS {
  readonly doc: Document;
  highlight: (range: Range) => void;
  #section: MediaOverlaySection;
  #blockIndex = -1;
  #lastMark: string | null = null;

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
    this.#blockIndex = par.blockIndex;
    this.#lastMark = mark;
    this.highlight(par.range.cloneRange());
    return par.range;
  }

  getLastRange(): Range | undefined {
    if (!this.#lastMark) return undefined;
    return this.#section.parByMark(this.#lastMark)?.range.cloneRange();
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
    return target ? this.#enter(target.blockIndex, target.markName) : this.#enter(0, null);
  }
}
