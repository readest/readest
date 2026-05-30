import type { PromptLayer } from './types';

/**
 * Memory layers — placeholders for Phase 3. Each takes a `provider()`
 * callback so Phase 3's MemoryService implementations can plug in without
 * touching this file or the builder. Today the providers usually return
 * empty strings; the layer renders null in that case and the builder
 * skips it.
 *
 * Shrink priorities per plan §2.5:
 *   ToolCatalog (10) → Reading (20) → BookMemory (30) → UserMemory (40).
 *
 * Both memory layers are expendable but BookMemory shrinks first because
 * book-specific facts are more easily re-derived (lookupPassage can
 * rebuild them) than user-stable preferences.
 */

export type MemoryProvider = () => string;

export function createBookMemoryLayer(provider: MemoryProvider): PromptLayer {
  return memoryLayer('bookMemory', 40, 30, 'Book memory', provider);
}

export function createUserMemoryLayer(provider: MemoryProvider): PromptLayer {
  return memoryLayer('userMemory', 50, 40, 'User memory', provider);
}

function memoryLayer(
  name: string,
  renderPriority: number,
  shrinkPriority: number,
  headline: string,
  provider: MemoryProvider,
): PromptLayer {
  return {
    name,
    renderPriority,
    shrinkPriority,
    expendable: true,
    render() {
      const body = provider().trim();
      return body.length > 0 ? `${headline}:\n${body}` : null;
    },
    shrink(level) {
      const body = provider().trim();
      if (body.length === 0) return null;
      if (level <= 0) return `${headline}:\n${body}`;
      if (level === 1) return `${headline}: ${truncateForTerse(body)}`;
      return null;
    },
  };
}

function truncateForTerse(s: string): string {
  const max = 200;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
