import type { RetrievedChunk } from '@/services/reedy/retrieval/BookRetriever';

/**
 * Shape the Sources UI in M1.10 will render against. Both legacy IDB
 * ScoredChunk and Reedy RetrievedChunk are widenable to this — keeping the
 * UI agnostic of which backend produced the citation. `cfi` is optional
 * because the legacy path has no CFI to navigate to.
 */
export interface SourceItem {
  id: string;
  bookHash?: string;
  sectionIndex: number;
  chapterTitle: string | null;
  text: string;
  cfi?: string;
  endCfi?: string;
  positionIndex?: number;
  score?: number;
}

/**
 * Per-adapter-instance store of retrieved passages, keyed by the synthetic
 * `turnId` the adapter generates for each outgoing assistant turn.
 *
 * Replaces the previous module-global `lastSources` array + 500ms poll
 * (`AIAssistant.tsx:210`) per plan §M1.7. The Sources dropdown in M1.10
 * subscribes to a turn's slot rather than racing against a global mutation.
 *
 * The store is intentionally per-instance (not a module singleton) so
 * unmounting the AI tab releases its memory and concurrent adapter
 * instances (unlikely today but cheap to support) don't trip over each
 * other.
 */
export class ReedySourceStore {
  private readonly sources = new Map<string, RetrievedChunk[]>();
  private readonly listeners = new Map<string, Set<(chunks: RetrievedChunk[]) => void>>();

  /** Replace this turn's sources with `chunks` and notify subscribers. */
  replace(turnId: string, chunks: RetrievedChunk[]): void {
    this.sources.set(turnId, chunks);
    this.emit(turnId);
  }

  /** Merge new chunks into this turn's sources (dedup by id) and notify. */
  append(turnId: string, chunks: RetrievedChunk[]): void {
    const existing = this.sources.get(turnId) ?? [];
    const seen = new Set(existing.map((c) => c.id));
    const merged = [...existing];
    for (const c of chunks) {
      if (!seen.has(c.id)) {
        merged.push(c);
        seen.add(c.id);
      }
    }
    this.sources.set(turnId, merged);
    this.emit(turnId);
  }

  /** Current snapshot for `turnId`; returns an empty array if unknown. */
  get(turnId: string): RetrievedChunk[] {
    return this.sources.get(turnId) ?? [];
  }

  /** Subscribe to future updates for `turnId`. Returns an unsubscribe fn. */
  subscribe(turnId: string, listener: (chunks: RetrievedChunk[]) => void): () => void {
    let set = this.listeners.get(turnId);
    if (!set) {
      set = new Set();
      this.listeners.set(turnId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(turnId);
    };
  }

  /**
   * Remove `turnId` from the store. Safe to call while a stream is in
   * flight — the in-progress write is independent of this map entry; the
   * caller is responsible for not removing turns whose UI is still
   * rendering.
   */
  remove(turnId: string): void {
    this.sources.delete(turnId);
    this.listeners.delete(turnId);
  }

  /** Drop every turn's sources. */
  clear(): void {
    this.sources.clear();
    this.listeners.clear();
  }

  private emit(turnId: string): void {
    const set = this.listeners.get(turnId);
    if (!set) return;
    const snapshot = this.get(turnId);
    for (const fn of set) fn(snapshot);
  }
}
