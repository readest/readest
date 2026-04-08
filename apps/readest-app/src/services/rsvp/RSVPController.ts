import { FoliateView } from '@/types/view';
import { RsvpWord, RsvpState, RsvpPosition, RsvpStopPosition, RsvpStartChoice } from './types';
import { containsCJK, splitTextIntoWords, getHyphenParts } from './utils';
import { compare as compareCFI } from 'foliate-js/epubcfi.js';
import { XCFI } from '@/utils/xcfi';

const DEFAULT_WPM = 300;
const MIN_WPM = 100;
const MAX_WPM = 1000;
const WPM_STEP = 50;
const DEFAULT_PUNCTUATION_PAUSE_MS = 100;
const PUNCTUATION_PAUSE_OPTIONS = [25, 50, 75, 100, 125, 150, 175, 200];
const DEFAULT_SPLIT_HYPHENS = false;
const STORAGE_KEY_PREFIX = 'readest_rsvp_wpm_';
const PUNCTUATION_PAUSE_KEY_PREFIX = 'readest_rsvp_pause_';
const POSITION_KEY_PREFIX = 'readest_rsvp_pos_';
const SPLIT_HYPHENS_KEY = 'readest_rsvp_split_hyphens';

export class RSVPController extends EventTarget {
  private view: FoliateView;
  private bookId: string; // Book hash without session suffix, for persistent storage
  private currentCfi: string | null = null;

  private state: RsvpState = {
    active: false,
    playing: false,
    words: [],
    currentIndex: 0,
    currentPartIndex: 0,
    wpm: DEFAULT_WPM,
    punctuationPauseMs: DEFAULT_PUNCTUATION_PAUSE_MS,
    splitHyphens: DEFAULT_SPLIT_HYPHENS,
    progress: 0,
  };

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private pendingStartWordIndex: number | null = null;
  private countdown: number | null = null;

  constructor(view: FoliateView, bookKey: string) {
    super();
    this.view = view;
    // Extract book ID (hash) from bookKey format: "{hash}-{sessionId}"
    // Use only the hash for persistent position storage across sessions
    this.bookId = bookKey.split('-')[0] || bookKey;
    this.loadSettings();
  }

  private loadSettings(): void {
    const savedWpm = this.loadWpmFromStorage();
    if (savedWpm) {
      this.state.wpm = savedWpm;
    }
    const savedPause = this.loadPunctuationPauseFromStorage();
    if (savedPause) {
      this.state.punctuationPauseMs = savedPause;
    }
    const savedSplitHyphens = this.loadSplitHyphensFromStorage();
    if (savedSplitHyphens !== null) {
      this.state.splitHyphens = savedSplitHyphens;
    }
  }

  get currentState(): RsvpState {
    return {
      ...this.state,
      progress:
        this.state.words.length > 0 ? (this.state.currentIndex / this.state.words.length) * 100 : 0,
    };
  }

  get currentWord(): RsvpWord | null {
    if (this.state.currentIndex >= 0 && this.state.currentIndex < this.state.words.length) {
      return this.state.words[this.state.currentIndex]!;
    }
    return null;
  }

  get currentDisplayWord(): RsvpWord | null {
    const word = this.currentWord;
    if (!word) return null;
    if (!this.state.splitHyphens) return word;
    const parts = getHyphenParts(word.text);
    if (parts.length <= 1) return word;
    const partText = parts[this.state.currentPartIndex] ?? word.text;
    return { ...word, text: partText, orpIndex: this.calculateORP(partText) };
  }

  get currentCountdown(): number | null {
    return this.countdown;
  }

  getPunctuationPauseOptions(): number[] {
    return PUNCTUATION_PAUSE_OPTIONS;
  }

  getWpmOptions(): number[] {
    const options: number[] = [];
    for (let wpm = MIN_WPM; wpm <= MAX_WPM; wpm += WPM_STEP) {
      options.push(wpm);
    }
    return options;
  }

  setPunctuationPause(pauseMs: number): void {
    if (PUNCTUATION_PAUSE_OPTIONS.includes(pauseMs)) {
      this.state.punctuationPauseMs = pauseMs;
      this.savePunctuationPauseToStorage(pauseMs);
      this.emitStateChange();
    }
  }

  private loadPunctuationPauseFromStorage(): number | null {
    const stored = localStorage.getItem(`${PUNCTUATION_PAUSE_KEY_PREFIX}${this.bookId}`);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && PUNCTUATION_PAUSE_OPTIONS.includes(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private savePunctuationPauseToStorage(pauseMs: number): void {
    localStorage.setItem(`${PUNCTUATION_PAUSE_KEY_PREFIX}${this.bookId}`, pauseMs.toString());
  }

  setWpm(wpm: number): void {
    const clampedWpm = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));
    this.state.wpm = clampedWpm;
    this.saveWpmToStorage(clampedWpm);
    this.emitStateChange();
  }

  private loadWpmFromStorage(): number | null {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${this.bookId}`);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_WPM && parsed <= MAX_WPM) {
        return parsed;
      }
    }
    return null;
  }

  private saveWpmToStorage(wpm: number): void {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${this.bookId}`, wpm.toString());
  }

  getSplitHyphens(): boolean {
    return this.state.splitHyphens;
  }

  setSplitHyphens(value: boolean): void {
    this.state.splitHyphens = value;
    try {
      localStorage.setItem(SPLIT_HYPHENS_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.emitStateChange();
  }

  private loadSplitHyphensFromStorage(): boolean | null {
    try {
      const stored = localStorage.getItem(SPLIT_HYPHENS_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      /* ignore */
    }
    return null;
  }

  setCurrentCfi(cfi: string | null): void {
    this.currentCfi = cfi;
  }

  private loadPositionFromStorage(): RsvpPosition | null {
    const stored = localStorage.getItem(`${POSITION_KEY_PREFIX}${this.bookId}`);
    if (stored) {
      try {
        return JSON.parse(stored) as RsvpPosition;
      } catch {
        return null;
      }
    }
    return null;
  }

  private savePositionToStorage(): void {
    if (this.state.words.length === 0) return;

    const currentWord = this.state.words[this.state.currentIndex];
    if (!currentWord) return;

    const cfi = currentWord.cfi || this.currentCfi;
    if (!cfi) return;

    const position: RsvpPosition = {
      cfi,
      wordText: currentWord.text,
    };
    localStorage.setItem(`${POSITION_KEY_PREFIX}${this.bookId}`, JSON.stringify(position));
  }

  private clearPositionFromStorage(): void {
    localStorage.removeItem(`${POSITION_KEY_PREFIX}${this.bookId}`);
  }

  seedPosition(position: RsvpPosition): void {
    const storageKey = `${POSITION_KEY_PREFIX}${this.bookId}`;
    if (!localStorage.getItem(storageKey)) {
      localStorage.setItem(storageKey, JSON.stringify(position));
    }
  }

  getStoredPosition(): RsvpPosition | null {
    return this.loadPositionFromStorage();
  }

  private getSpineIndex(cfi: string): number {
    try {
      return XCFI.extractSpineIndex(cfi);
    } catch {
      return -1;
    }
  }

  private isSameSection(cfi1: string | null, cfi2: string | null): boolean {
    if (!cfi1 || !cfi2) return false;
    const spine1 = this.getSpineIndex(cfi1);
    const spine2 = this.getSpineIndex(cfi2);
    return spine1 >= 0 && spine1 === spine2;
  }

  private findWordIndexByCfi(words: RsvpWord[], targetCfi: string): number {
    // First try exact CFI match
    for (let i = 0; i < words.length; i++) {
      if (words[i]?.cfi === targetCfi) return i;
    }

    // Find the first word at or after the target position using CFI compare
    const targetSpineIndex = this.getSpineIndex(targetCfi);
    if (targetSpineIndex < 0) return -1;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word?.cfi) continue;
      if (this.getSpineIndex(word.cfi) !== targetSpineIndex) continue;
      if (compareCFI(word.cfi, targetCfi) >= 0) return i;
    }

    return -1;
  }

  start(retryCount = 0): void {
    const words = this.extractWordsWithRanges();
    if (words.length === 0) {
      if (retryCount < 3) {
        setTimeout(() => this.start(retryCount + 1), 150 * (retryCount + 1));
        return;
      }
      this.dispatchEvent(new CustomEvent('rsvp-request-next-page'));
      return;
    }

    let startIndex = 0;

    if (this.pendingStartWordIndex !== null && this.pendingStartWordIndex < words.length) {
      startIndex = this.pendingStartWordIndex;
      this.pendingStartWordIndex = null;
    } else {
      const savedPosition = this.loadPositionFromStorage();
      if (savedPosition?.cfi) {
        const cfiIndex = this.findWordIndexByCfi(words, savedPosition.cfi);
        if (cfiIndex >= 0) {
          startIndex = cfiIndex;
        } else {
          const textIndex = words.findIndex((w) => w.text === savedPosition.wordText);
          if (textIndex >= 0) {
            startIndex = textIndex;
          }
        }
      }
    }

    const clampedStart = words.length > 0 ? Math.min(words.length - 1, Math.max(0, startIndex)) : 0;
    this.state = {
      ...this.state,
      active: true,
      playing: true,
      words,
      currentIndex: clampedStart,
    };
    this.emitStateChange();

    this.startCountdown(() => {
      this.scheduleNextWord();
    });
  }

  pause(): void {
    this.clearTimer();
    this.clearCountdown();
    this.state.playing = false;
    this.emitStateChange();
  }

  resume(): void {
    if (!this.state.active) return;
    this.state.playing = true;
    this.emitStateChange();
    this.startCountdown(() => {
      this.scheduleNextWord();
    });
  }

  private startCountdown(onComplete: () => void): void {
    this.clearCountdown();
    let count = 3;
    this.countdown = count;
    this.emitCountdownChange();

    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.countdown = count;
        this.emitCountdownChange();
      } else {
        this.clearCountdown();
        onComplete();
      }
    }, 500);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.countdown = null;
    this.emitCountdownChange();
  }

  togglePlayPause(): void {
    if (this.state.playing) {
      this.pause();
    } else {
      this.resume();
    }
  }

  stop(): void {
    this.savePositionToStorage();

    let stopPosition: RsvpStopPosition | null = null;
    if (this.state.words.length > 0) {
      const currentWord = this.state.words[this.state.currentIndex];
      stopPosition = {
        wordIndex: this.state.currentIndex,
        totalWords: this.state.words.length,
        text: currentWord?.text || '',
        range: currentWord?.range,
        docIndex: currentWord?.docIndex,
        cfi: currentWord?.cfi,
      };
    }

    this.dispatchEvent(new CustomEvent('rsvp-stop', { detail: stopPosition }));

    this.clearTimer();
    this.clearCountdown();
    this.state = {
      ...this.state,
      active: false,
      playing: false,
      words: [],
      currentIndex: 0,
      currentPartIndex: 0,
    };
    this.emitStateChange();
  }

  requestStart(selectionText?: string): void {
    const savedPosition = this.loadPositionFromStorage();
    const hasSavedPosition = !!savedPosition?.cfi;
    const hasSelection = !!selectionText && selectionText.trim().length > 0;

    this.dispatchEvent(
      new CustomEvent('rsvp-start-choice', {
        detail: {
          hasSavedPosition,
          hasSelection,
          selectionText: selectionText?.trim(),
        } as RsvpStartChoice,
      }),
    );
  }

  startFromBeginning(): void {
    this.clearPositionFromStorage();
    this.pendingStartWordIndex = null;
    this.start();
  }

  startFromSavedPosition(): void {
    const savedPosition = this.loadPositionFromStorage();
    if (!savedPosition?.cfi) {
      this.start();
      return;
    }

    if (!this.isSameSection(savedPosition.cfi, this.currentCfi)) {
      this.dispatchEvent(
        new CustomEvent('rsvp-navigate-to-resume', { detail: { cfi: savedPosition.cfi } }),
      );
      return;
    }

    this.pendingStartWordIndex = null;
    this.start();
  }

  startFromCurrentPosition(): void {
    this.clearPositionFromStorage();
    const words = this.extractWordsWithRanges();

    let startIndex = 0;
    if (this.currentCfi) {
      const cfiIndex = this.findWordIndexByCfi(words, this.currentCfi);
      if (cfiIndex >= 0) startIndex = cfiIndex;
    }

    this.pendingStartWordIndex = startIndex > 0 ? startIndex : null;
    this.start();
  }

  startFromSelection(selectionText: string): void {
    this.clearPositionFromStorage();
    const words = this.extractWordsWithRanges();
    const selectionIndex = this.findWordIndexBySelection(words, selectionText);
    this.pendingStartWordIndex = selectionIndex >= 0 ? selectionIndex : null;
    this.start();
  }

  private findWordIndexBySelection(words: RsvpWord[], selectionText: string): number {
    if (!selectionText || words.length === 0) return -1;

    const cleanSelection = selectionText.trim();
    if (!cleanSelection) return -1;

    const hasCJK = containsCJK(cleanSelection);

    if (hasCJK) {
      const selectionLower = cleanSelection.toLowerCase();

      for (let i = 0; i < words.length; i++) {
        let continuousText = '';
        for (let j = i; j < Math.min(i + 20, words.length); j++) {
          continuousText += words[j]!.text;
          if (continuousText.toLowerCase().includes(selectionLower)) {
            return i;
          }
        }
      }

      const firstChars = cleanSelection.slice(0, Math.min(3, cleanSelection.length)).toLowerCase();
      for (let i = 0; i < words.length; i++) {
        if (words[i]!.text.toLowerCase().includes(firstChars)) {
          return i;
        }
      }

      return -1;
    }

    const cleanSelectionLower = cleanSelection.toLowerCase();
    const selectionWords = cleanSelectionLower.split(/\s+/);
    if (selectionWords.length === 0) return -1;

    const firstSelectionWord = selectionWords[0]!;

    for (let i = 0; i < words.length; i++) {
      const word = words[i]!;
      const cleanWord = word.text.toLowerCase().replace(/[^\w]/g, '');
      const cleanFirstWord = firstSelectionWord.replace(/[^\w]/g, '');

      if (
        cleanWord === cleanFirstWord ||
        cleanWord.includes(cleanFirstWord) ||
        cleanFirstWord.includes(cleanWord)
      ) {
        if (selectionWords.length === 1) return i;

        let matchCount = 1;
        for (let j = 1; j < selectionWords.length && i + j < words.length; j++) {
          const nextWord = words[i + j]!.text.toLowerCase().replace(/[^\w]/g, '');
          const nextSelectionWord = selectionWords[j]!.replace(/[^\w]/g, '');
          if (nextWord === nextSelectionWord || nextWord.includes(nextSelectionWord)) {
            matchCount++;
          } else {
            break;
          }
        }

        if (matchCount >= Math.ceil(selectionWords.length / 2)) return i;
      }
    }

    return -1;
  }

  increaseSpeed(): void {
    const newWpm = Math.min(MAX_WPM, this.state.wpm + WPM_STEP);
    this.state.wpm = newWpm;
    this.saveWpmToStorage(newWpm);
    this.emitStateChange();
  }

  decreaseSpeed(): void {
    const newWpm = Math.max(MIN_WPM, this.state.wpm - WPM_STEP);
    this.state.wpm = newWpm;
    this.saveWpmToStorage(newWpm);
    this.emitStateChange();
  }

  skipForward(count: number = 10): void {
    this.state.currentIndex = Math.min(
      this.state.words.length - 1,
      this.state.currentIndex + count,
    );
    this.state.currentPartIndex = 0;
    this.emitStateChange();
  }

  skipBackward(count: number = 10): void {
    this.state.currentIndex = Math.max(0, this.state.currentIndex - count);
    this.state.currentPartIndex = 0;
    this.emitStateChange();
  }

  seekToPosition(percentage: number): void {
    if (this.state.words.length === 0) return;
    const newIndex = Math.floor((percentage / 100) * this.state.words.length);
    this.state.currentIndex = Math.max(0, Math.min(this.state.words.length - 1, newIndex));
    this.state.currentPartIndex = 0;
    this.emitStateChange();
  }

  seekToIndex(index: number): void {
    if (this.state.words.length === 0) return;
    this.state.currentIndex = Math.max(0, Math.min(this.state.words.length - 1, index));
    this.state.currentPartIndex = 0;
    this.emitStateChange();
  }

  loadNextPageContent(retryCount = 0): void {
    this.clearTimer();
    const words = this.extractWordsWithRanges();
    if (words.length === 0) {
      if (retryCount < 3) {
        setTimeout(() => this.loadNextPageContent(retryCount + 1), 200 * (retryCount + 1));
        return;
      }
      this.dispatchEvent(new CustomEvent('rsvp-request-next-page'));
      return;
    }

    const wasPlaying = this.state.playing;
    this.state = {
      ...this.state,
      playing: false,
      words,
      currentIndex: 0,
      currentPartIndex: 0,
    };
    this.emitStateChange();

    if (wasPlaying) {
      this.state.playing = true;
      this.emitStateChange();
      this.startCountdown(() => {
        this.scheduleNextWord();
      });
    }
  }

  private scheduleNextWord(): void {
    this.clearTimer();

    if (!this.state.playing || !this.state.active) return;

    if (this.state.currentIndex >= this.state.words.length) {
      this.dispatchEvent(new CustomEvent('rsvp-request-next-page'));
      return;
    }

    const displayWord = this.currentDisplayWord!;
    const duration = this.getWordDisplayDuration(displayWord, this.state.wpm);

    this.playbackTimer = setTimeout(() => {
      this.advanceToNextWord();
    }, duration);
  }

  private advanceToNextWord(): void {
    const word = this.currentWord;
    if (word && this.state.splitHyphens) {
      const parts = getHyphenParts(word.text);
      if (this.state.currentPartIndex < parts.length - 1) {
        this.state.currentPartIndex += 1;
        this.emitStateChange();
        this.scheduleNextWord();
        return;
      }
    }

    const newIndex = this.state.currentIndex + 1;

    if (newIndex >= this.state.words.length) {
      this.dispatchEvent(new CustomEvent('rsvp-request-next-page'));
      return;
    }

    this.state.currentIndex = newIndex;
    this.state.currentPartIndex = 0;
    this.emitStateChange();

    this.scheduleNextWord();
  }

  private clearTimer(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  private extractWordsWithRanges(): RsvpWord[] {
    const renderer = this.view.renderer;
    if (!renderer) return [];

    const contents = renderer.getContents?.();
    if (!contents || contents.length === 0) return [];

    // Only process the primary spine section (one section at a time)
    const primary = contents.find((c) => c.index === renderer.primaryIndex) ?? contents[0];
    if (!primary) return [];

    const { doc, index: docIndex } = primary as { doc: Document; index: number };
    if (!doc?.body) return [];

    return this.extractWordsFromElement(doc.body, doc, docIndex);
  }

  private extractWordsFromElement(
    element: HTMLElement,
    doc: Document,
    docIndex: number,
  ): RsvpWord[] {
    const excludeTags = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'ASIDE']);
    const words: RsvpWord[] = [];

    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const nodeWords = splitTextIntoWords(text);

        let offset = 0;
        for (const word of nodeWords) {
          const wordStart = text.indexOf(word, offset);
          if (wordStart === -1) continue;

          try {
            const range = doc.createRange();
            range.setStart(node, wordStart);
            range.setEnd(node, wordStart + word.length);

            // Generate CFI for this word for position tracking
            let cfi: string | undefined;
            try {
              cfi = this.view.getCFI(docIndex, range);
            } catch {
              // CFI generation failed, will fall back to word index
              cfi = undefined;
            }

            words.push({
              text: word,
              orpIndex: this.calculateORP(word),
              pauseMultiplier: this.getPauseMultiplier(word),
              range,
              docIndex,
              cfi,
            });
          } catch {
            words.push({
              text: word,
              orpIndex: this.calculateORP(word),
              pauseMultiplier: this.getPauseMultiplier(word),
            });
          }

          offset = wordStart + word.length;
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as HTMLElement;
      if (excludeTags.has(el.tagName.toUpperCase())) return;

      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      if (style?.display === 'none' || style?.visibility === 'hidden') return;

      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }
    };

    walk(element);

    // Insert a blank ISI frame between consecutive identical words.
    return words.flatMap((word, i) =>
      i + 1 < words.length && word.text === words[i + 1]!.text
        ? [word, { text: ' ', orpIndex: 0, pauseMultiplier: 0.5 }]
        : [word],
    );
  }

  private calculateORP(word: string): number {
    const hasCJK = containsCJK(word);

    if (hasCJK) {
      // For CJK characters, center the ORP since each character is more balanced
      return Math.floor(word.length / 2);
    }

    const cleanWord = word.replace(/[^\w]/g, '');
    const len = cleanWord.length;

    if (len <= 1) return 0;
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 8) return 2;
    return 3;
  }

  private getPauseMultiplier(word: string): number {
    const hasCJK = containsCJK(word);

    if (hasCJK) {
      // CJK characters are information-dense, adjust pause based on character count
      // With semantic segmentation, words can vary in length
      const len = word.length;
      if (len >= 5) return 1.4; // Longer compound words
      if (len >= 4) return 1.3;
      if (len >= 3) return 1.2;
      if (len >= 2) return 1.0;
      return 0.9; // Single characters
    }

    if (word.length > 12) return 1.3;
    if (word.length > 8) return 1.1;
    return 1.0;
  }

  private getWordDisplayDuration(word: RsvpWord, wpm: number): number {
    const baseMs = 60000 / wpm;
    let duration = baseMs * word.pauseMultiplier;

    if (/[.!?,;:]$/.test(word.text)) {
      duration += this.state.punctuationPauseMs;
    }

    return duration;
  }

  private emitStateChange(): void {
    this.dispatchEvent(new CustomEvent('rsvp-state-change', { detail: this.currentState }));
  }

  private emitCountdownChange(): void {
    this.dispatchEvent(new CustomEvent('rsvp-countdown-change', { detail: this.countdown }));
  }

  shutdown(): void {
    this.stop();
    this.clearPositionFromStorage();
    this.currentCfi = null;
  }
}
