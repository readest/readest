import { FoliateView } from '@/types/view';
import { RsvpWord, RsvpState, RsvpPosition, RsvpStopPosition, RsvpStartChoice } from './types';
import { containsCJK, splitTextIntoWords } from './utils';

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
  private bookId: string; // Book hash without session suffix, for persistent storage
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
    // Use bookId (without session suffix) for persistent position across sessions
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

    // Use the word's CFI if available, otherwise fall back to section CFI
    const cfi = currentWord.cfi || this.currentCfi;
    if (!cfi) return;

    const position: RsvpPosition = {
      cfi: cfi,
      wordText: currentWord.text,
    };
    // Use bookId (without session suffix) for persistent position across sessions
    localStorage.setItem(`${POSITION_KEY_PREFIX}${this.bookId}`, JSON.stringify(position));
  }

  private clearPositionFromStorage(): void {
    // Use bookId (without session suffix) for persistent position across sessions
    localStorage.removeItem(`${POSITION_KEY_PREFIX}${this.bookId}`);
  }

  /**
   * Extract the spine/section reference from a CFI.
   * For `epubcfi(/6/6!/4/2/2/6,/1:363,/1:366)`, returns `/6/6!`
   * This identifies which section/chapter the CFI points to.
   */
  private extractSpineRef(cfi: string): string {
    const inner = cfi.replace(/^epubcfi\(/, '').replace(/\)$/, '');
    // Remove range portion (everything after first comma)
    const parts = inner.split(',');
    const path = parts[0]!;

    // Extract up to and including the `!` separator (spine reference)
    // The `!` separates the package document path from the content document path
    const spineMatch = path.match(/^([^!]+!)/);
    if (spineMatch) {
      return spineMatch[1]!;
    }

    // Fallback: if no `!`, try to extract up to `]` (for step assertions)
    const bracketMatch = path.match(/^(.*\][^\/]*)/);
    if (bracketMatch) {
      return bracketMatch[1]!;
    }

    // Last resort: return the full path before any range
    return path;
  }

  private isSameSection(cfi1: string | null, cfi2: string | null): boolean {
    if (!cfi1 || !cfi2) return false;
    const spine1 = this.extractSpineRef(cfi1);
    const spine2 = this.extractSpineRef(cfi2);
    return spine1 === spine2;
  }

  /**
   * Extract the full document path from a CFI, including range start for precise positioning.
   * For range CFIs like `epubcfi(/6/10!/4/2/2/6,/168,/214/1:171)`:
   * - Base path: `/4/2/2/6`
   * - Range start: `/168` (relative offset)
   * - Returns: { path: `/4/2/2/6/168`, charOffset: 0 }
   *
   * For word CFIs like `epubcfi(/6/10!/4/2/2/6/6,/1:0,/1:7)`:
   * - Base path: `/4/2/2/6/6`
   * - Range start: `/1:0` (text node with character offset)
   * - Returns: { path: `/4/2/2/6/6/1`, charOffset: 0 }
   *
   * For page CFIs like `epubcfi(/6/20!/4/2,/24/1:91,/54/1:184)`:
   * - Base path: `/4/2`
   * - Range start: `/24/1:91` (element /24, text node /1, char 91)
   * - Returns: { path: `/4/2/24/1`, charOffset: 91 }
   */
  private extractFullDocPathWithOffset(cfi: string): { path: string; charOffset: number } {
    const inner = cfi.replace(/^epubcfi\(/, '').replace(/\)$/, '');
    const parts = inner.split(',');
    const fullPath = parts[0]!;
    const bangIndex = fullPath.indexOf('!');
    let basePath = bangIndex >= 0 ? fullPath.substring(bangIndex + 1) : fullPath;
    let charOffset = 0;

    // If there's a range start (second comma-separated part), append it to the base path
    // This handles CFIs like `epubcfi(/6/10!/4/2/2/6,/168,/214/1:171)` where /168 is the offset
    if (parts.length >= 2 && parts[1]) {
      let rangeStart = parts[1];
      // Extract character offset (`:N`) before removing it
      const charMatch = rangeStart.match(/:(\d+)$/);
      if (charMatch) {
        charOffset = parseInt(charMatch[1]!, 10);
        rangeStart = rangeStart.replace(/:\d+$/, '');
      }
      if (rangeStart && rangeStart !== '/') {
        basePath = basePath + rangeStart;
      }
    }

    return { path: basePath, charOffset };
  }

  /**
   * Compare two CFI document paths to determine order.
   * Returns: negative if path1 < path2, positive if path1 > path2, 0 if equal
   */
  private compareCfiPaths(path1: string, path2: string): number {
    // Parse paths into step arrays: "/4/2/6" -> [4, 2, 6]
    const steps1 = path1.split('/').filter(Boolean).map((s) => parseInt(s.replace(/\[.*\]/, ''), 10));
    const steps2 = path2.split('/').filter(Boolean).map((s) => parseInt(s.replace(/\[.*\]/, ''), 10));

    const minLen = Math.min(steps1.length, steps2.length);
    for (let i = 0; i < minLen; i++) {
      const s1 = steps1[i] ?? 0;
      const s2 = steps2[i] ?? 0;
      if (s1 !== s2) return s1 - s2;
    }

    // If all compared steps are equal, shorter path comes first
    return steps1.length - steps2.length;
  }

  /**
   * Compare two CFI positions including character offsets.
   * Returns: negative if pos1 < pos2, positive if pos1 > pos2, 0 if equal
   */
  private compareCfiPositions(
    pos1: { path: string; charOffset: number },
    pos2: { path: string; charOffset: number },
  ): number {
    const pathComparison = this.compareCfiPaths(pos1.path, pos2.path);
    if (pathComparison !== 0) return pathComparison;
    // Paths are equal, compare character offsets
    return pos1.charOffset - pos2.charOffset;
  }

  private findWordIndexByCfi(words: RsvpWord[], targetCfi: string): number {
    // First try exact CFI match
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word?.cfi === targetCfi) {
        return i;
      }
    }

    // Check if target is in same section as any word
    const targetSpine = this.extractSpineRef(targetCfi);
    // Use extractFullDocPathWithOffset for accurate position including character offset
    const targetPos = this.extractFullDocPathWithOffset(targetCfi);

    // Find the first word at or after the target position (by CFI path + char offset comparison)
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word?.cfi) continue;

      // Must be in the same section
      if (this.extractSpineRef(word.cfi) !== targetSpine) continue;

      // Compare document paths + character offsets - find first word at or after target
      const wordPos = this.extractFullDocPathWithOffset(word.cfi);
      if (this.compareCfiPositions(wordPos, targetPos) >= 0) {
        return i;
      }
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
      return;
    }

    let startIndex = 0;
    let resumedFromIndex: number | null = null;

    if (this.pendingStartWordIndex !== null && this.pendingStartWordIndex < words.length) {
      startIndex = this.pendingStartWordIndex;
      this.pendingStartWordIndex = null;
    } else {
      const savedPosition = this.loadPositionFromStorage();
      if (savedPosition) {
        // Try CFI-based position recovery first
        if (savedPosition.cfi) {
          const cfiIndex = this.findWordIndexByCfi(words, savedPosition.cfi);
          if (cfiIndex >= 0) {
            startIndex = cfiIndex;
            resumedFromIndex = cfiIndex;
          } else {
            // CFI not found, try text match as fallback
            const textMatchIndex = words.findIndex((w) => w.text === savedPosition.wordText);
            if (textMatchIndex >= 0) {
              startIndex = textMatchIndex;
              resumedFromIndex = textMatchIndex;
            }
          }
        } else {
          // Legacy position without CFI - try text match
          const textMatchIndex = words.findIndex((w) => w.text === savedPosition.wordText);
          if (textMatchIndex >= 0) {
            startIndex = textMatchIndex;
            resumedFromIndex = textMatchIndex;
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
      progress: 0,
      resumedFromIndex: null,
    };
    this.emitStateChange();
  }

  requestStart(selectionText?: string): void {
    const savedPosition = this.loadPositionFromStorage();
    // Show Resume option if we have a saved position with a valid CFI
    // We don't require it to be in the same section - user may want to resume
    // from where they left off even if they've navigated elsewhere
    const hasSavedPosition = !!(savedPosition?.cfi);
    const hasSelection = !!selectionText && selectionText.trim().length > 0;

    const startChoice: RsvpStartChoice = {
      hasSavedPosition,
      hasSelection,
      selectionText: selectionText?.trim(),
    };

    this.dispatchEvent(new CustomEvent('rsvp-start-choice', { detail: startChoice }));
  }

  startFromBeginning(): void {
    this.clearPositionFromStorage();
    this.pendingStartWordIndex = null;
    this.start();
  }

  startFromSavedPosition(): void {
    const savedPosition = this.loadPositionFromStorage();
    if (!savedPosition?.cfi) {
      // No saved position, start from beginning
      this.start();
      return;
    }

    // Check if saved position is in a different section
    if (!this.isSameSection(savedPosition.cfi, this.currentCfi)) {
      // Need to navigate to the saved section first
      // Emit event for React component to handle navigation
      this.dispatchEvent(
        new CustomEvent('rsvp-navigate-to-resume', {
          detail: { cfi: savedPosition.cfi },
        }),
      );
      return;
    }

    this.pendingStartWordIndex = null;
    this.start();
  }

  startFromCurrentPosition(): void {
    this.clearPositionFromStorage();
    const words = this.extractWordsWithRanges();

    // Use CFI-based matching to find the first word at current page position
    let startIndex = 0;
    if (this.currentCfi) {
      const cfiIndex = this.findWordIndexByCfi(words, this.currentCfi);
      if (cfiIndex >= 0) {
        startIndex = cfiIndex;
      }
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

      // Build a continuous text from words for matching
      for (let i = 0; i < words.length; i++) {
        let continuousText = '';
        for (let j = i; j < Math.min(i + 20, words.length); j++) {
          continuousText += words[j]!.text;
          if (continuousText.toLowerCase().includes(selectionLower)) {
            return i;
          }
        }
      }

      // Fallback: try to match first few characters
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
        const nodeWords = splitTextIntoWords(text);
        console.log('Extracted words from text node:', nodeWords);

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
    const hasCJK = containsCJK(word);

    if (hasCJK) {
      // For CJK characters, center the ORP since each character is more balanced
      const len = word.length;
      return Math.floor(len / 2);
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
