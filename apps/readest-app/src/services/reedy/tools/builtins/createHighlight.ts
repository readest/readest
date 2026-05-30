import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { AnnotationServices } from './types';

const inputSchema = z.object({
  cfi: z.string().min(1),
  endCfi: z.string().optional(),
  text: z.string().min(1).max(10_000),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'red']).optional(),
});

export interface CreateHighlightResult {
  id: string;
}

/**
 * Create a highlight on the user's book through the existing annotation
 * service. `permission: 'write'` — the ToolRegistry prompts the user
 * before every call (no auto-approve, even after the first), since
 * highlights mutate the user's annotations and we'd rather over-prompt
 * than land a surprise edit.
 *
 * The annotation service callback owns persistence (Hardcover sync, local
 * IDB, etc.); the tool only translates the model's request into the call.
 */
export function createCreateHighlightTool(
  services: Pick<AnnotationServices, 'createHighlight'>,
): ReedyTool<z.input<typeof inputSchema>, CreateHighlightResult> {
  return {
    name: 'createHighlight',
    description:
      "Highlight a passage in the user's book at the given CFI range. Optionally pick a color. Call this only when the user explicitly asks to highlight something — never unsolicited.",
    permission: 'write',
    parallelSafe: false,
    inputSchema,
    async run(args) {
      const created = await services.createHighlight({
        cfi: args.cfi,
        endCfi: args.endCfi,
        text: args.text,
        color: args.color,
      });
      return { id: created.id };
    },
  };
}
