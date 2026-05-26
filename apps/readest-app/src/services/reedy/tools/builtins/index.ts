/**
 * Phase 2.4 built-in tools — each factory takes its dependencies as an
 * argument so callers (AgentRuntime, tests) wire whatever read/write/
 * navigate surfaces they have. Memory tools (families 3, 4, 5) ship after
 * Phase 3.
 */
export { createGetReadingContextTool } from './getReadingContext';
export { createGetSelectionTool } from './getSelection';
export type { GetSelectionResult } from './getSelection';
export { createLookupPassageTool } from './lookupPassage';
export type { LookupPassageDeps, LookupPassageResult } from './lookupPassage';
export { createAddCitationTool } from './addCitation';
export type { AddCitationResult } from './addCitation';
export { createNavigateToCfiTool } from './navigateToCfi';
export { createCreateHighlightTool } from './createHighlight';
export type { CreateHighlightResult } from './createHighlight';
export { createCreateNoteTool } from './createNote';
export type { CreateNoteResult } from './createNote';
export type {
  AnnotationServices,
  CitationData,
  CreateHighlightArgs,
  CreateNoteArgs,
  NavigateResult,
  ReadingContextSnapshot,
} from './types';
