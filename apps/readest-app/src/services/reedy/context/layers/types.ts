/**
 * Each layer of the system prompt is an object with:
 *   - a stable `name` (for the truncated[] report)
 *   - a fixed render order (`renderPriority`, low = first in the system prompt)
 *   - an `expendable` flag so the shrink algorithm can drop / abridge it
 *   - a `shrinkPriority` (low = shrink first)
 *   - `render()` returning the full text
 *   - `shrink(level)` returning increasingly shorter forms, or null when the
 *     layer can be dropped entirely.
 *
 * Layer impls live in ./PolicyLayer.ts, SkillLayer.ts, ReadingLayer.ts,
 * ToolCatalogLayer.ts, plus the placeholder UserMemoryLayer / BookMemoryLayer
 * that fill out in Phase 3.
 */
export interface PromptLayer {
  readonly name: string;
  /** Render order in the final system prompt; lower comes first. */
  readonly renderPriority: number;
  /** Shrink order — lower = shrunk first. Fixed layers (Policy / Skill) use 999. */
  readonly shrinkPriority: number;
  /** True for layers that may be shrunk or dropped under budget pressure. */
  readonly expendable: boolean;
  /** Full content. May return null to indicate "nothing to render at all". */
  render(): string | null;
  /**
   * Shorter form for shrink level >= 1, or null when the layer should be
   * dropped entirely. Non-expendable layers return their render() at any
   * level so the builder never silently drops policy.
   */
  shrink(level: number): string | null;
}
