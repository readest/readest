import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { AnnotationServices } from './types';

const inputSchema = z.object({
  cfi: z.string().min(1),
  endCfi: z.string().optional(),
  quotedText: z.string().min(1).max(10_000),
  note: z.string().min(1).max(10_000),
});

export interface CreateNoteResult {
  id: string;
}

/**
 * Create a note attached to a passage in the user's book. Like
 * `createHighlight`, marked `permission: 'write'` so the user approves
 * each call before any annotation lands. The note body is the model's
 * own commentary; quotedText is the passage being annotated.
 */
export function createCreateNoteTool(
  services: Pick<AnnotationServices, 'createNote'>,
): ReedyTool<z.input<typeof inputSchema>, CreateNoteResult> {
  return {
    name: 'createNote',
    description:
      "Attach a note to a passage in the user's book at the given CFI range. The note body is your commentary; quotedText is the original passage. Call this only when the user explicitly asks to add a note.",
    permission: 'write',
    parallelSafe: false,
    inputSchema,
    async run(args) {
      const created = await services.createNote({
        cfi: args.cfi,
        endCfi: args.endCfi,
        quotedText: args.quotedText,
        note: args.note,
      });
      return { id: created.id };
    },
  };
}
