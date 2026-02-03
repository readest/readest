export interface RsvpWord {
  text: string;
  orpIndex: number;
  pauseMultiplier: number;
  range?: Range;
  docIndex?: number;
  docWordIndex?: number; // Index of this word within its document (for position recovery)
}

export interface RsvpState {
  active: boolean;
  playing: boolean;
  words: RsvpWord[];
  currentIndex: number;
  wpm: number;
  punctuationPauseMs: number;
  progress: number;
  resumedFromIndex: number | null;
}

export interface RsvpPosition {
  cfi: string;
  wordIndex: number;
  wordText: string;
}

export interface RsvpStopPosition {
  wordIndex: number;
  totalWords: number;
  text: string;
  range?: Range;
  docIndex?: number;
  docWordIndex?: number; // Index within the specific document (for position recovery)
  docTotalWords?: number; // Total words in the specific document
}

export interface RsvpStartChoice {
  hasSavedPosition: boolean;
  hasSelection: boolean;
  selectionText?: string;
  firstVisibleWordIndex: number;
}
