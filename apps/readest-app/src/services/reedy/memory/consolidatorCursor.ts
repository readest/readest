import type { ConsolidatorMessage } from './MemoryConsolidator';
import type { ReedyMessage } from '../store/reedyStore';

/**
 * Slice the store's message log to the tail after a given id (exclusive),
 * normalizing to the ConsolidatorMessage shape the MemoryConsolidator
 * accepts. Used by ReedyAssistant's post-turn consolidate hook so we
 * never re-summarize already-distilled turns.
 *
 * `afterId === null` (no prior consolidation) returns the whole log.
 * `afterId` not found in the log (e.g. user cleared the conversation)
 * also returns the whole log — the safer fallback, since the alternative
 * is to skip consolidation entirely.
 */
export function sliceSinceLastId(
  messages: readonly ReedyMessage[],
  afterId: string | null,
): ConsolidatorMessage[] {
  const startIdx =
    afterId == null
      ? 0
      : (() => {
          const idx = messages.findIndex((m) => m.id === afterId);
          return idx >= 0 ? idx + 1 : 0;
        })();
  const tail = messages.slice(startIdx);
  return tail.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.role === 'user' ? m.text : flattenAssistantText(m),
    createdAt: m.createdAt,
  }));
}

function flattenAssistantText(m: Extract<ReedyMessage, { role: 'assistant' }>): string {
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
