import type { Tool } from 'ai';
import type { BookDoc } from '@/libs/document';
import type { AISettings, EmbeddingProgress, ScoredChunk } from '../types';
import type { ReedySourceStore } from './reedySourceStore';

export type RetrievalBackendKind = 'legacy-idb' | 'reedy';

export interface BackendIndexOptions {
  onProgress?: (progress: EmbeddingProgress) => void;
  signal?: AbortSignal;
}

/**
 * Common surface every retrieval backend exposes. Two implementations exist:
 *
 *   - `LegacyIdbBackend` — wraps the original IndexedDB-backed ragService
 *     (`indexBook`, `isBookIndexed`, `hybridSearch`, `aiStore.clearBook`).
 *     Used on web and as the fallback when Reedy is disabled or unavailable.
 *   - `ReedyBackend` — wraps Reedy's BookIndexer + BookRetriever and
 *     exposes a `lookupPassage` Vercel tool to the chat adapter.
 *
 * The legacy path injects retrieved chunks into the system prompt (the
 * model never sees a tool). The Reedy path lets the model decide when to
 * call lookupPassage; results land in `ReedySourceStore` under the
 * adapter's per-turn id.
 */
export interface RetrievalBackend {
  readonly kind: RetrievalBackendKind;

  isIndexed(bookHash: string): Promise<boolean>;
  indexBook(bookDoc: BookDoc, bookHash: string, options?: BackendIndexOptions): Promise<void>;
  clearBook(bookHash: string): Promise<void>;

  /**
   * Legacy IDB path only. Returns top-K chunks the adapter folds into the
   * system prompt before calling streamText. `undefined` on Reedy.
   */
  searchForSystemPrompt?(
    query: string,
    bookHash: string,
    options: { topK: number; spoilerBoundPosition?: number },
  ): Promise<ScoredChunk[]>;

  /**
   * Reedy path only. Returns the Vercel `ai`-SDK Tool the adapter passes
   * via `streamText({ tools: { lookupPassage: ... } })`. `undefined` on
   * legacy.
   */
  buildLookupTool?(args: {
    bookHash: string;
    turnId: string;
    sourceStore: ReedySourceStore;
    spoilerBoundPosition?: number;
  }): Tool;
}

/**
 * Pick the backend for a turn. Reedy is gated behind both the user setting
 * AND the Tauri platform per plan D15 — web users always get the legacy
 * path so the MVP cohort is desktop-only.
 */
export function selectBackend(args: {
  settings: AISettings;
  isTauri: boolean;
  legacy: RetrievalBackend;
  reedy: RetrievalBackend | null;
}): RetrievalBackend {
  if (args.settings.reedy?.enabled && args.isTauri && args.reedy) {
    return args.reedy;
  }
  return args.legacy;
}
