export interface RsvpWord {
  text: string;
  orpIndex: number;
  pauseMultiplier: number;
  range?: Range;
  docIndex?: number;
  cfi?: string; // Canonical Fragment Identifier for precise position tracking
}

export interface RsvpState {
  active: boolean;
  playing: boolean;
  words: RsvpWord[];
  currentIndex: number;
  currentPartIndex: number;
  wpm: number;
  punctuationPauseMs: number;
  splitHyphens: boolean;
  progress: number;
}

export interface RsvpPosition {
  cfi: string;
  wordText: string;
}

export interface RsvpStopPosition {
  wordIndex: number;
  totalWords: number;
  text: string;
  range?: Range;
  docIndex?: number;
  cfi?: string; // Canonical Fragment Identifier for the stop position
}

export interface RsvpStartChoice {
  hasSavedPosition: boolean;
  hasSelection: boolean;
  selectionText?: string;
}
