import { FoliateView } from '@/types/view';
import { RsvpWord, RsvpState, RsvpPosition, RsvpStopPosition, RsvpStartChoice } from './types';
import { containsCJK, isCJKPunctuation, splitTextIntoWords, getHyphenParts } from './utils';
import { compare as compareCFI } from 'foliate-js/epubcfi.js';
import { XCFI } from '@/utils/xcfi';

const DEFAULT_WPM = 300;
const MIN_WPM = 100;
const MAX_WPM = 1000;
const WPM_STEP = 50;
const DEFAULT_PUNCTUATION_PAUSE_MS = 100;
const PUNCTUATION_PAUSE_OPTIONS = [25, 50, 75, 100, 125, 150, 175, 200];
const DEFAULT_SPLIT_HYPHENS = false;
const DEFAULT_CJK_CHAR_MODE = false;
const DEFAULT_START_DELAY_SECONDS = 3;
const START_DELAY_OPTIONS = [0, 1, 2, 3];
const STORAGE_KEY_PREFIX = 'readest_rsvp_wpm_';
const PUNCTUATION_PAUSE_KEY_PREFIX = 'readest_rsvp_pause_';
const POSITION_KEY_PREFIX = 'readest_rsvp_pos_';
const SPLIT_HYPHENS_KEY = 'readest_rsvp_split_hyphens';
const CJK_CHAR_MODE_KEY = 'readest_rsvp_cjk_char_mode';
const START_DELAY_KEY = 'readest_rsvp_start_delay';

// Section-only CFI (no '!') sorts before any word CFI in that section.
const stripCfiPath = (cfi: string): string => cfi.replace(/!.*\)$/, ')');

export class RSVPController extends EventTarget {
  private view: FoliateView;
  private bookId: string; // Book hash without session suffix, for persistent storage
  private currentCfi: string | null = null;
  private primaryLanguage: string | undefined;

  private state: RsvpState = {
    active: false,
    playing: false,
    words: [],
    currentIndex: 0,
    currentPartIndex: 0,
    wpm: DEFAULT_WPM,
    punctuationPauseMs: DEFAULT_PUNCTUATION_PAUSE_MS,
    splitHyphens: DEFAULT_SPLIT_HYPHENS,
    cjkCharMode: DEFAULT_CJK_CHAR_MODE,
    startDelaySeconds: DEFAULT_START_DELAY_SECONDS,
    hasCJK: false,
    progress: 0,
  };

  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private pendingStartWordIndex: number | null = null;
  private countdown: number | null = null;
  private cachedWords: { docIndex: number; doc: Document; words: RsvpWord[] } | null = null;

  // Slice 3a (#3235): externally-driven sync (e.g. TTS drives RSVP word display).
  // #lastSyncIndex is a monotonic cursor so forward word-by-word sync scans from
  // the previous match (~O(1)) instead of from 0; backward seeks binary-search.
  #lastSyncIndex = -1;
  // While true, scheduleNextWord becomes a no-op so the auto-advance timer never
  // fires — the external driver owns advancement via syncToCfi.
  #externallyDriven = false;

  constructor(view: FoliateView, bookKey: string, primaryLanguage?: string) {
    super();
    this.view = view;
    // Extract book ID (hash) from bookKey format: "{hash}-{sessionId}"
    // Use only the hash for persistent position storage across sessions
    this.bookId = bookKey.split('-')[0] || bookKey;
    this.primaryLanguage = primaryLanguage;
    this.loadSettings();
  }

  setPrimaryLanguage(lang: string | undefined): void {
    if (this.primaryLanguage === lang) return;
    this.primaryLanguage = lang;
    // Language changes invalidate the segmentation result.
    this.cachedWords = null;
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
    const savedCjkCharMode = this.loadCjkCharModeFromStorage();
    if (savedCjkCharMode !== null) {
      this.state.cjkCharMode = savedCjkCharMode;
    }
    const savedStartDelay = this.loadStartDelayFromStorage();
    if (savedStartDelay !== null) {
      this.state.startDelaySeconds = savedStartDelay;
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

  setCjkCharMode(value: boolean): void {
    if (this.state.cjkCharMode === value) return;
    this.state.cjkCharMode = value;
    try {
      localStorage.setItem(CJK_CHAR_MODE_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
    // Char mode changes the segmentation result, so the cached words and the
    // current section's word list both need to be rebuilt.
    this.cachedWords = null;
    if (this.state.active) {
      this.reextractPreservingPosition();
    } else {
      this.emitStateChange();
    }
  }

  private loadCjkCharModeFromStorage(): boolean | null {
    try {
      const stored = localStorage.getItem(CJK_CHAR_MODE_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      /* ignore */
    }
    return null;
  }

  getStartDelayOptions(): number[] {
    return START_DELAY_OPTIONS;
  }

  setStartDelay(seconds: number): void {
    if (!START_DELAY_OPTIONS.includes(seconds)) return;
    this.state.startDelaySeconds = seconds;
    try {
      localStorage.setItem(START_DELAY_KEY, seconds.toString());
    } catch {
      /* ignore */
    }
    this.emitStateChange();
  }

  private loadStartDelayFromStorage(): number | null {
    try {
      const stored = localStorage.getItem(START_DELAY_KEY);
      if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if (START_DELAY_OPTIONS.includes(parsed)) return parsed;
      }
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

    const cfi = this.getCfiForWord(currentWord) || this.currentCfi;
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

  seedPosition(position: RsvpPosition, currentLocationCfi?: string | null): void {
    const key = `${POSITION_KEY_PREFIX}${this.bookId}`;
    let final = position;

    // Cross-chapter mismatch means stale sync (exit pins them together);
    // fall back to the start of the location's chapter.
    if (
      currentLocationCfi &&
      position.cfi &&
      !this.isSameSection(position.cfi, currentLocationCfi)
    ) {
      console.warn('[RSVP] rsvpPosition chapter mismatch; resetting to start of synced chapter', {
        rsvpCfi: position.cfi,
        locationCfi: currentLocationCfi,
      });
      final = { cfi: stripCfiPath(currentLocationCfi), wordText: '' };
    }

    const serialized = JSON.stringify(final);
    if (localStorage.getItem(key) === serialized) return;
    localStorage.setItem(key, serialized);
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
    const targetSpineIndex = this.getSpineIndex(targetCfi);
    if (targetSpineIndex < 0) return -1;

    // Resolve target CFI to a Range in the section's document so we can
    // find the matching word by range comparison (O(1) per check) rather
    // than by per-word CFI generation, which dominates extract cost on
    // long sections.
    const targetRange = this.resolveCfiToRange(targetCfi, targetSpineIndex);
    if (targetRange) {
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (!word?.range) continue;
        if (word.docIndex !== targetSpineIndex) continue;
        try {
          if (word.range.compareBoundaryPoints(Range.START_TO_START, targetRange) >= 0) {
            return i;
          }
        } catch {
          // Cross-document range compare throws; skip.
        }
      }
    }

    // Fallback: per-word CFI compare (slow path, used when the CFI cannot
    // be resolved to a range — e.g. fixed-layout pages).
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word?.range || word.docIndex === undefined) continue;
      let wordCfi: string | undefined;
      try {
        wordCfi = this.view.getCFI(word.docIndex, word.range);
      } catch {
        continue;
      }
      if (!wordCfi) continue;
      if (this.getSpineIndex(wordCfi) !== targetSpineIndex) continue;
      if (compareCFI(wordCfi, targetCfi) >= 0) return i;
    }

    return -1;
  }

  private resolveCfiToRange(cfi: string, spineIndex: number): Range | null {
    try {
      const renderer = this.view.renderer;
      const contents = renderer?.getContents?.();
      if (!contents) return null;
      const target = (contents as Array<{ doc: Document; index: number }>).find(
        (c) => c.index === spineIndex,
      );
      if (!target) return null;
      const resolved = (
        this.view as unknown as {
          resolveCFI?: (cfi: string) => { index: number; anchor?: (doc: Document) => unknown };
        }
      ).resolveCFI?.(cfi);
      if (!resolved || resolved.index !== spineIndex || typeof resolved.anchor !== 'function') {
        return null;
      }
      const anchor = resolved.anchor(target.doc);
      if (anchor instanceof Range) return anchor;
      if (anchor && anchor instanceof target.doc.defaultView!.Node) {
        const range = target.doc.createRange();
        range.selectNode(anchor as Node);
        return range;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getCfiForWord(word: RsvpWord | undefined): string | undefined {
    if (!word?.range || word.docIndex === undefined) return undefined;
    try {
      return this.view.getCFI(word.docIndex, word.range);
    } catch {
      return undefined;
    }
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
    // New word list => the sync cursor from any previous section is stale.
    this.#lastSyncIndex = -1;
    this.state = {
      ...this.state,
      active: true,
      playing: true,
      words,
      currentIndex: clampedStart,
      hasCJK: this.computeHasCJK(words),
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

    // A delay of 0 means instant start — skip the countdown entirely.
    let count = this.state.startDelaySeconds;
    if (count <= 0) {
      onComplete();
      return;
    }

    this.countdown = count;
    this.emitCountdownChange();

    // Tick at real one-second intervals so the displayed number matches the
    // configured delay in seconds.
    this.countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        this.countdown = count;
        this.emitCountdownChange();
      } else {
        this.clearCountdown();
        onComplete();
      }
    }, 1000);
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
        cfi: this.getCfiForWord(currentWord),
      };
    }

    this.dispatchEvent(new CustomEvent('rsvp-stop', { detail: stopPosition }));

    this.clearTimer();
    this.clearCountdown();
    this.#lastSyncIndex = -1;
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

  // Manual single-word stepping for self-paced reading (#4476). Pauses
  // playback first so repeated presses advance exactly one word at a time;
  // resume is left to the user.
  nextWord(): void {
    if (this.state.playing) this.pause();
    this.state.currentIndex = Math.min(
      Math.max(0, this.state.words.length - 1),
      this.state.currentIndex + 1,
    );
    this.state.currentPartIndex = 0;
    this.emitStateChange();
  }

  prevWord(): void {
    if (this.state.playing) this.pause();
    this.state.currentIndex = Math.max(0, this.state.currentIndex - 1);
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

  // Slice 3a (#3235): suspend/restore the auto-advance timer so an external
  // driver (e.g. TTS) can own word advancement via syncToCfi without the
  // controller's own setTimeout racing it.
  setExternallyDriven(on: boolean): void {
    if (this.#externallyDriven === on) return;
    this.#externallyDriven = on;
    if (on) {
      // Stop any pending auto-advance immediately.
      this.clearTimer();
    } else if (this.state.playing && this.state.active) {
      // Resume normal auto-advance from the current word.
      this.scheduleNextWord();
    }
  }

  // Slice 3a (#3235): drive the displayed word from an external CFI (e.g. the
  // word/sentence TTS is currently speaking). Resolves the CFI to a DOM range
  // via the same fast path findWordIndexByCfi uses (no per-word view.getCFI),
  // maps it to a word by CONTAINMENT (fixing the mid-token skip), and displays
  // that word WITHOUT arming the auto-advance timer. Returns false (leaving
  // currentIndex untouched) when the CFI can't be resolved in this section.
  syncToCfi(cfi: string): boolean {
    const words = this.state.words;
    if (words.length === 0) return false;

    const targetSpineIndex = this.getSpineIndex(cfi);
    if (targetSpineIndex < 0) return false;

    const targetRange = this.resolveCfiToRange(cfi, targetSpineIndex);
    if (!targetRange) return false;

    const index = this.findWordIndexContaining(words, targetRange, targetSpineIndex);
    if (index < 0) return false;

    this.#lastSyncIndex = index;
    this.state.currentIndex = index;
    this.state.currentPartIndex = 0;
    // Display the word but do NOT call scheduleNextWord(): the external driver
    // controls advancement. This mirrors the seek display path (set index +
    // emit) minus the timer.
    this.emitStateChange();
    return true;
  }

  // Map a resolved target range to a word by CONTAINMENT: the word whose range
  // contains the target's start position. If the target falls in a gap
  // (whitespace between words), fall back to the nearest FOLLOWING word.
  //
  // Uses a monotonic cursor (#lastSyncIndex): forward syncs scan from the last
  // match (~O(1)); a target before the cursor binary-searches the
  // document-ordered word ranges.
  private findWordIndexContaining(
    words: RsvpWord[],
    targetRange: Range,
    targetSpineIndex: number,
  ): number {
    const cursor = this.#lastSyncIndex;

    // Decide direction: if the target starts before the cursor word, binary
    // search backward; otherwise linear-scan forward from the cursor.
    let backward = false;
    if (cursor >= 0 && cursor < words.length) {
      const cursorRange = words[cursor]?.range;
      if (cursorRange && words[cursor]?.docIndex === targetSpineIndex) {
        try {
          // target.start < cursor.start  =>  cursor.start > target.start
          backward = cursorRange.compareBoundaryPoints(Range.START_TO_START, targetRange) > 0;
        } catch {
          backward = false;
        }
      }
    }

    if (backward) {
      const found = this.binarySearchWord(words, targetRange, targetSpineIndex);
      if (found >= 0) return found;
      // Fall through to a forward scan from 0 if binary search couldn't decide.
    }

    return this.linearScanWord(
      words,
      targetRange,
      targetSpineIndex,
      backward ? 0 : Math.max(0, cursor),
    );
  }

  // Forward linear scan from `from`. Returns the containing word, else the
  // nearest following word (gap fallback).
  private linearScanWord(
    words: RsvpWord[],
    targetRange: Range,
    targetSpineIndex: number,
    from: number,
  ): number {
    let firstFollowing = -1;
    for (let i = from; i < words.length; i++) {
      const word = words[i];
      if (!word?.range || word.docIndex !== targetSpineIndex) continue;
      const rel = this.compareWordToTarget(word.range, targetRange);
      if (rel === 0) return i; // contains the target start
      if (rel > 0 && firstFollowing < 0) firstFollowing = i; // first word after target
    }
    return firstFollowing;
  }

  // Binary search over the document-ordered word ranges for the word containing
  // the target start; if none contains it, return the nearest following word.
  private binarySearchWord(
    words: RsvpWord[],
    targetRange: Range,
    targetSpineIndex: number,
  ): number {
    let lo = 0;
    let hi = words.length - 1;
    let firstFollowing = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const word = words[mid];
      if (!word?.range || word.docIndex !== targetSpineIndex) {
        // Ranges without a comparable range break ordering; fall back to a
        // linear scan from the low bound.
        return this.linearScanWord(words, targetRange, targetSpineIndex, lo);
      }
      const rel = this.compareWordToTarget(word.range, targetRange);
      if (rel === 0) return mid;
      if (rel < 0) {
        // word is entirely before the target — search right.
        lo = mid + 1;
      } else {
        // word starts after the target — candidate following word.
        firstFollowing = mid;
        hi = mid - 1;
      }
    }
    return firstFollowing;
  }

  // Classify a word range relative to a collapsed target position:
  //  -1 : word ends at-or-before the target start (word is before the target)
  //   0 : word contains the target start (word.start <= target < word.end)
  //  +1 : word starts after the target start (word is after the target)
  private compareWordToTarget(wordRange: Range, targetRange: Range): number {
    try {
      // DOM compareBoundaryPoints(how, source) semantics:
      //   START_TO_START -> this.start vs source.start
      //   START_TO_END   -> this.end   vs source.start
      // (END_TO_START is this.start vs source.end — NOT what we want here.)
      const startCmp = wordRange.compareBoundaryPoints(Range.START_TO_START, targetRange);
      if (startCmp > 0) return 1; // word starts after the target start
      // word.start <= target.start. Check word.end vs target.start.
      const endCmp = wordRange.compareBoundaryPoints(Range.START_TO_END, targetRange);
      if (endCmp > 0) return 0; // word.end > target.start  => contains the target start
      return -1; // word.end <= target.start => word entirely before the target
    } catch {
      return -1;
    }
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
    // New section => the sync cursor from the previous section is stale.
    this.#lastSyncIndex = -1;
    this.state = {
      ...this.state,
      playing: false,
      words,
      currentIndex: 0,
      currentPartIndex: 0,
      hasCJK: this.computeHasCJK(words),
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

  // Re-segment the current section in place after a setting (e.g. char mode)
  // changes the word list. Keeps the reader near the same spot by matching the
  // previous word's range against the new word list.
  private reextractPreservingPosition(): void {
    this.clearTimer();
    const prevWord = this.state.words[this.state.currentIndex];
    const words = this.extractWordsWithRanges();

    let newIndex = 0;
    if (words.length > 0 && prevWord?.range && prevWord.docIndex !== undefined) {
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (!word?.range || word.docIndex !== prevWord.docIndex) continue;
        try {
          if (word.range.compareBoundaryPoints(Range.START_TO_START, prevWord.range) >= 0) {
            newIndex = i;
            break;
          }
        } catch {
          // Detached or cross-document range compare throws; skip.
        }
      }
    }

    // Re-segmentation invalidates the prior word indices the cursor referenced.
    this.#lastSyncIndex = -1;
    this.state = {
      ...this.state,
      words,
      currentIndex: words.length > 0 ? Math.min(words.length - 1, Math.max(0, newIndex)) : 0,
      currentPartIndex: 0,
      hasCJK: this.computeHasCJK(words),
    };
    this.emitStateChange();

    if (this.state.playing && words.length > 0) {
      this.scheduleNextWord();
    }
  }

  private computeHasCJK(words: RsvpWord[]): boolean {
    return words.some((word) => containsCJK(word.text));
  }

  private scheduleNextWord(): void {
    this.clearTimer();

    // When externally driven (e.g. by TTS), the driver advances words via
    // syncToCfi; the auto-advance timer must never arm.
    if (this.#externallyDriven) return;

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

    if (
      this.cachedWords &&
      this.cachedWords.docIndex === docIndex &&
      this.cachedWords.doc === doc
    ) {
      return this.cachedWords.words;
    }

    const words = this.extractWordsFromElement(doc.body, doc, docIndex);
    this.cachedWords = { docIndex, doc, words };
    return words;
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
        const nodeWords = splitTextIntoWords(text, this.primaryLanguage, this.state.cjkCharMode);

        let offset = 0;
        for (const word of nodeWords) {
          const wordStart = text.indexOf(word, offset);
          if (wordStart === -1) continue;

          try {
            const range = doc.createRange();
            range.setStart(node, wordStart);
            range.setEnd(node, wordStart + word.length);

            // CFI is computed lazily — see savePositionToStorage(),
            // stop(), and findWordIndexByCfi(). At 45k+ words/section,
            // eager generation dominates extract time.
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
      // Center the ORP on a real character — never on trailing punctuation.
      // Char mode emits tokens like "是。" where a naive length/2 would land
      // the focus on the punctuation instead of the character.
      let coreLength = word.length;
      while (coreLength > 0 && isCJKPunctuation(word[coreLength - 1]!)) {
        coreLength--;
      }
      return Math.floor(Math.max(coreLength, 1) / 2);
    }

    const cleanWord = word.replace(/[^\p{L}\p{N}_]/gu, '');
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

    if (/[.!?,;:–—]$/.test(word.text)) {
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
    this.cachedWords = null;
  }
}
