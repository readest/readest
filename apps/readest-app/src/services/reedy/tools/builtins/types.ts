/**
 * Shared types for the built-in Reedy tools (Phase 2.4).
 *
 * These are deliberately small interfaces — each tool factory takes a
 * narrowly-typed dependency rather than the whole reader/annotation/store
 * surface, so unit tests can mock cleanly and the runtime can swap impls
 * (e.g. Tauri reader view vs. a fake test view) without per-tool refactor.
 */

export interface ReadingContextSnapshot {
  /** Current CFI the user is on, or null when the book hasn't been opened. */
  cfi: string | null;
  sectionIndex: number;
  chapterTitle: string | null;
  /** Page number in Readest's 1500-chars-per-page formula. */
  pageNumber: number;
  /** Active text selection, if any. */
  selection?: {
    text: string;
    startCfi: string;
    endCfi: string;
  };
}

export interface CitationData {
  cfi: string;
  endCfi?: string;
  snippet: string;
  chapterTitle?: string;
  sectionIndex?: number;
}

export interface NavigateResult {
  navigated: boolean;
  /** Optional reason when navigated=false (e.g. "view-not-ready"). */
  reason?: string;
}

export interface CreateHighlightArgs {
  cfi: string;
  endCfi?: string;
  text: string;
  color?: string;
  note?: string;
}

export interface CreateNoteArgs {
  cfi: string;
  endCfi?: string;
  quotedText: string;
  note: string;
}

export interface AnnotationServices {
  createHighlight(args: CreateHighlightArgs): Promise<{ id: string }>;
  createNote(args: CreateNoteArgs): Promise<{ id: string }>;
}
