import { FoliateView } from '@/types/view';
import { RsvpWord, RsvpState, RsvpPosition, RsvpStopPosition, RsvpStartChoice } from './types';

const DEFAULT_WPM = 300;
const MIN_WPM = 100;
const MAX_WPM = 1000;
const WPM_STEP = 50;
const DEFAULT_PUNCTUATION_PAUSE_MS = 100;
const PUNCTUATION_PAUSE_OPTIONS = [25, 50, 75, 100, 125, 150, 175, 200];
const STORAGE_KEY_PREFIX = 'readest_rsvp_wpm_';
const PUNCTUATION_PAUSE_KEY_PREFIX = 'readest_rsvp_pause_';
const POSITION_KEY_PREFIX = 'readest_rsvp_pos_';

export class RSVPController extends EventTarget {
  private view: FoliateView;
  private bookKey: string;
  private currentCfi: string | null = null;

  private state: RsvpState = {
    active: false,
    playing: false,
    words: [],
    currentIndex: 0,
    wpm: DEFAULT_WPM,
    punctuationPauseMs: DEFAULT_PUNCTUATION_PAUSE_MS,
    progress: 0,
    resumedFromIndex: null,
  };

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private pendingStartWordIndex: number | null = null;
  private countdown: number | null = null;

  constructor(view: FoliateView, bookKey: string) {
    super();
    this.view = view;
    this.bookKey = bookKey;
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
  }

  get currentState(): RsvpState {
    return { ...this.state };
  }

  get currentWord(): RsvpWord | null {
    if (this.state.currentIndex >= 0 && this.state.currentIndex < this.state.words.length) {
      return this.state.words[this.state.currentIndex]!;
    }
    return null;
  }

  get currentCountdown(): number | null {
    return this.countdown;
  }

  getPunctuationPauseOptions(): number[] {
    return PUNCTUATION_PAUSE_OPTIONS;
  }

  setPunctuationPause(pauseMs: number): void {
    if (PUNCTUATION_PAUSE_OPTIONS.includes(pauseMs)) {
      this.state.punctuationPauseMs = pauseMs;
      this.savePunctuationPauseToStorage(pauseMs);
      this.emitStateChange();
    }
  }

  private loadPunctuationPauseFromStorage(): number | null {
    const stored = localStorage.getItem(`${PUNCTUATION_PAUSE_KEY_PREFIX}${this.bookKey}`);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && PUNCTUATION_PAUSE_OPTIONS.includes(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private savePunctuationPauseToStorage(pauseMs: number): void {
    localStorage.setItem(`${PUNCTUATION_PAUSE_KEY_PREFIX}${this.bookKey}`, pauseMs.toString());
  }

  setWpm(wpm: number): void {
    const clampedWpm = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));
    this.state.wpm = clampedWpm;
    this.saveWpmToStorage(clampedWpm);
    this.emitStateChange();
  }

  private loadWpmFromStorage(): number | null {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${this.bookKey}`);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_WPM && parsed <= MAX_WPM) {
        return parsed;
      }
    }
    return null;
  }

  private saveWpmToStorage(wpm: number): void {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${this.bookKey}`, wpm.toString());
  }

  setCurrentCfi(cfi: string | null): void {
    this.currentCfi = cfi;
  }

  private loadPositionFromStorage(): RsvpPosition | null {
    const stored = localStorage.getItem(`${POSITION_KEY_PREFIX}${this.bookKey}`);
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
    if (!this.currentCfi) return;
    if (this.state.words.length === 0) return;

    const position: RsvpPosition = {
      cfi: this.currentCfi,
      wordIndex: this.state.currentIndex,
      wordText: this.state.words[this.state.currentIndex]?.text || '',
    };
    localStorage.setItem(`${POSITION_KEY_PREFIX}${this.bookKey}`, JSON.stringify(position));
  }

  private clearPositionFromStorage(): void {
    localStorage.removeItem(`${POSITION_KEY_PREFIX}${this.bookKey}`);
  }

  private extractBaseCfi(cfi: string): string {
    const inner = cfi.replace(/^epubcfi\(/, '').replace(/\)$/, '');
    const parts = inner.split(',');
    let basePath = parts[0]!;
    const match = basePath.match(/^(.*\][^\/]*)/);
    if (match) {
      basePath = match[1]!;
    }
    return basePath;
  }

  private isSameSection(cfi1: string | null, cfi2: string | null): boolean {
    if (!cfi1 || !cfi2) return false;
    const base1 = this.extractBaseCfi(cfi1);
    const base2 = this.extractBaseCfi(cfi2);
    return base1 === base2;
  }

  start(retryCount = 0): void {
    const words = this.extractWordsWithRanges();
    if (words.length === 0) {
      if (retryCount < 3) {
        setTimeout(() => this.start(retryCount + 1), 150 * (retryCount + 1));
        return;
      }
      return;
    }

    let startIndex = 0;
    let resumedFromIndex: number | null = null;

    if (this.pendingStartWordIndex !== null && this.pendingStartWordIndex < words.length) {
      startIndex = this.pendingStartWordIndex;
      this.pendingStartWordIndex = null;
    } else {
      const savedPosition = this.loadPositionFromStorage();
      if (savedPosition && this.isSameSection(savedPosition.cfi, this.currentCfi)) {
        if (savedPosition.wordIndex < words.length) {
          if (words[savedPosition.wordIndex]?.text === savedPosition.wordText) {
            startIndex = savedPosition.wordIndex;
            resumedFromIndex = savedPosition.wordIndex;
          }
        }
      }
    }

    this.state = {
      ...this.state,
      active: true,
      playing: false,
      words,
      currentIndex: startIndex,
      progress: (startIndex / words.length) * 100,
      resumedFromIndex,
    };
    this.emitStateChange();

    this.startCountdown(() => {
      this.state.playing = true;
      this.emitStateChange();
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
    this.startCountdown(() => {
      this.state.playing = true;
      this.emitStateChange();
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
    }, 800);
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

    const stopPosition: RsvpStopPosition | null =
      this.state.words.length > 0
        ? {
            wordIndex: this.state.currentIndex,
            totalWords: this.state.words.length,
            text: this.state.words[this.state.currentIndex]?.text || '',
            range: this.state.words[this.state.currentIndex]?.range,
            docIndex: this.state.words[this.state.currentIndex]?.docIndex,
          }
        : null;

    this.dispatchEvent(new CustomEvent('rsvp-stop', { detail: stopPosition }));

    this.clearTimer();
    this.clearCountdown();
    this.state = {
      ...this.state,
      active: false,
      playing: false,
      words: [],
      currentIndex: 0,
      progress: 0,
      resumedFromIndex: null,
    };
    this.emitStateChange();
  }

  requestStart(selectionText?: string): void {
    const words = this.extractWordsWithRanges();
    const firstVisibleWordIndex = this.findFirstVisibleWordIndex(words);

    const savedPosition = this.loadPositionFromStorage();
    const hasSavedPosition = !!(
      savedPosition && this.isSameSection(savedPosition.cfi, this.currentCfi)
    );
    const hasSelection = !!selectionText && selectionText.trim().length > 0;

    const startChoice: RsvpStartChoice = {
      hasSavedPosition,
      hasSelection,
      selectionText: selectionText?.trim(),
      firstVisibleWordIndex,
    };

    this.dispatchEvent(new CustomEvent('rsvp-start-choice', { detail: startChoice }));
  }

  startFromBeginning(): void {
    this.clearPositionFromStorage();
    this.pendingStartWordIndex = null;
    this.start();
  }

  startFromSavedPosition(): void {
    this.pendingStartWordIndex = null;
    this.start();
  }

  startFromCurrentPosition(): void {
    this.clearPositionFromStorage();
    const words = this.extractWordsWithRanges();
    const firstVisibleIndex = this.findFirstVisibleWordIndex(words);
    this.pendingStartWordIndex = firstVisibleIndex > 0 ? firstVisibleIndex : null;
    this.start();
  }

  startFromSelection(selectionText: string): void {
    this.clearPositionFromStorage();
    const words = this.extractWordsWithRanges();
    const selectionIndex = this.findWordIndexBySelection(words, selectionText);
    this.pendingStartWordIndex = selectionIndex >= 0 ? selectionIndex : null;
    this.start();
  }

  private findFirstVisibleWordIndex(words: RsvpWord[]): number {
    if (words.length === 0) return 0;

    try {
      const renderer = this.view.renderer;
      const scrollStart = renderer.start ?? 0;
      const pageSize = renderer.size ?? 0;

      if (pageSize > 0) {
        const visibleStart = scrollStart - pageSize;
        const visibleEnd = scrollStart;

        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          if (word?.range) {
            try {
              const rect = word.range.getBoundingClientRect();
              if (rect.width > 0 && rect.left >= visibleStart && rect.left < visibleEnd) {
                return i;
              }
            } catch {
              continue;
            }
          }
        }
      }
    } catch {
      // Fall through to return 0
    }

    return 0;
  }

  private findWordIndexBySelection(words: RsvpWord[], selectionText: string): number {
    if (!selectionText || words.length === 0) return -1;

    const cleanSelection = selectionText.trim().toLowerCase();
    if (!cleanSelection) return -1;

    const selectionWords = cleanSelection.split(/\s+/);
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
        if (selectionWords.length === 1) {
          return i;
        }

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

        if (matchCount >= Math.ceil(selectionWords.length / 2)) {
          return i;
        }
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
    const newIndex = Math.min(this.state.words.length - 1, this.state.currentIndex + count);
    this.state.currentIndex = newIndex;
    this.state.progress = (newIndex / this.state.words.length) * 100;
    this.emitStateChange();
  }

  skipBackward(count: number = 10): void {
    const newIndex = Math.max(0, this.state.currentIndex - count);
    this.state.currentIndex = newIndex;
    this.state.progress = (newIndex / this.state.words.length) * 100;
    this.emitStateChange();
  }

  seekToPosition(percentage: number): void {
    if (this.state.words.length === 0) return;
    const newIndex = Math.floor((percentage / 100) * this.state.words.length);
    const clampedIndex = Math.max(0, Math.min(this.state.words.length - 1, newIndex));
    this.state.currentIndex = clampedIndex;
    this.state.progress = (clampedIndex / this.state.words.length) * 100;
    this.emitStateChange();
  }

  loadNextPageContent(retryCount = 0): void {
    this.clearPositionFromStorage();

    const words = this.extractWordsWithRanges();
    if (words.length === 0) {
      if (retryCount < 3) {
        setTimeout(() => this.loadNextPageContent(retryCount + 1), 200 * (retryCount + 1));
        return;
      }
      this.pause();
      return;
    }

    const wasPlaying = this.state.playing;

    this.state = {
      ...this.state,
      words,
      currentIndex: 0,
      progress: 0,
      resumedFromIndex: null,
      playing: false,
    };
    this.emitStateChange();

    if (wasPlaying) {
      this.startCountdown(() => {
        this.state.playing = true;
        this.emitStateChange();
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

    const word = this.state.words[this.state.currentIndex]!;
    const duration = this.getWordDisplayDuration(word, this.state.wpm);

    this.playbackTimer = setTimeout(() => {
      this.advanceToNextWord();
    }, duration);
  }

  private advanceToNextWord(): void {
    const newIndex = this.state.currentIndex + 1;

    if (newIndex >= this.state.words.length) {
      this.dispatchEvent(new CustomEvent('rsvp-request-next-page'));
      return;
    }

    this.state.currentIndex = newIndex;
    this.state.progress = (newIndex / this.state.words.length) * 100;
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

    const allWords: RsvpWord[] = [];

    for (const content of contents) {
      const { doc, index: docIndex } = content as { doc: Document; index: number };
      if (!doc?.body) continue;

      const words = this.extractWordsFromElement(doc.body, doc, docIndex);
      allWords.push(...words);
    }

    return allWords;
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
        const nodeWords = text.split(/(\s+)/).filter((w) => w.trim().length > 0);

        let offset = 0;
        for (const word of nodeWords) {
          const wordStart = text.indexOf(word, offset);
          if (wordStart === -1) continue;

          try {
            const range = doc.createRange();
            range.setStart(node, wordStart);
            range.setEnd(node, wordStart + word.length);

            words.push({
              text: word,
              orpIndex: this.calculateORP(word),
              pauseMultiplier: this.getPauseMultiplier(word),
              range,
              docIndex,
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

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const el = node as HTMLElement;
      const tagName = el.tagName.toUpperCase();

      if (excludeTags.has(tagName)) {
        return;
      }

      const style = el.ownerDocument.defaultView?.getComputedStyle(el);
      if (style?.display === 'none' || style?.visibility === 'hidden') {
        return;
      }

      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }
    };

    walk(element);
    return words;
  }

  private calculateORP(word: string): number {
    const cleanWord = word.replace(/[^\w]/g, '');
    const len = cleanWord.length;

    if (len <= 1) return 0;
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 8) return 2;
    return 3;
  }

  private getPauseMultiplier(word: string): number {
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
