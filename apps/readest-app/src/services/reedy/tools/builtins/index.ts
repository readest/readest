/**
 * Built-in tools the agent runtime registers. Each factory takes its
 * dependencies as an argument so callers (AgentRuntime, tests) wire
 * whatever read/write/navigate surfaces they have. Memory families ship
 * alongside Phase 3.1's MemoryService.
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
export {
  createSearchUserMemoryTool,
  createWriteUserMemoryTool,
  createSearchBookMemoryTool,
  createWriteBookMemoryTool,
  createSearchSessionMemoryTool,
} from './memoryTools';
export type {
  SearchMemoryResult,
  SearchMemoryToolDeps,
  WriteMemoryResult,
  WriteMemoryToolDeps,
} from './memoryTools';
export type {
  AnnotationServices,
  CitationData,
  CreateHighlightArgs,
  CreateNoteArgs,
  NavigateResult,
  ReadingContextSnapshot,
} from './types';
