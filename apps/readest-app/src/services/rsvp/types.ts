export interface RsvpWord {
  text: string;
  orpIndex: number;
  pauseMultiplier: number;
  range?: Range;
  docIndex?: number;
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
}

export interface RsvpStartChoice {
  hasSavedPosition: boolean;
  hasSelection: boolean;
  selectionText?: string;
  firstVisibleWordIndex: number;
}
