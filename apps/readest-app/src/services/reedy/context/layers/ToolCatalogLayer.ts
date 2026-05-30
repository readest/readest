import type { PromptLayer } from './types';
import type { ReedyTool } from '../../tools/types';

/**
 * Lists registered tools so the model knows what's callable. Note: the
 * Vercel SDK itself serializes tool schemas to the model — this layer is
 * extra prose hint material the model can use to plan tool sequences.
 *
 * Shrink-first per plan (lowest shrinkPriority among expendable layers)
 * because the Vercel SDK still ships the tool definitions even when this
 * prose hint is gone.
 *
 * Shrink levels:
 *   0: tool list with one-line descriptions
 *   1: comma-separated names only
 *   2: drop
 */
export function createToolCatalogLayer(tools: ReedyTool[]): PromptLayer {
  return {
    name: 'toolCatalog',
    renderPriority: 30,
    shrinkPriority: 10,
    expendable: true,
    render() {
      return renderFull(tools);
    },
    shrink(level) {
      if (tools.length === 0) return null;
      if (level <= 0) return renderFull(tools);
      if (level === 1) return renderTerse(tools);
      return null;
    },
  };
}

function renderFull(tools: ReedyTool[]): string | null {
  if (tools.length === 0) return null;
  const lines = ['Available tools:'];
  for (const t of tools) lines.push(`- ${t.name}: ${t.description}`);
  return lines.join('\n');
}

function renderTerse(tools: ReedyTool[]): string {
  return `Available tools: ${tools.map((t) => t.name).join(', ')}.`;
}
