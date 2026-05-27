import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { CitationData } from './types';

const inputSchema = z.object({
  cfi: z.string().min(1),
  endCfi: z.string().optional(),
  snippet: z.string().min(1).max(2_000),
  chapterTitle: z.string().optional(),
  sectionIndex: z.number().int().nonnegative().optional(),
});

export interface AddCitationResult {
  ok: true;
}

/**
 * Lets the model attach an explicit citation to the current assistant
 * message without having to round-trip through `lookupPassage`. The
 * AgentRuntime (Phase 2.6) translates each successful invocation into a
 * `{ type: 'citation', ... }` ReedyEvent so the Sources UI can render it.
 */
export function createAddCitationTool(
  onCite: (citation: CitationData) => void | Promise<void>,
): ReedyTool<z.input<typeof inputSchema>, AddCitationResult> {
  return {
    name: 'addCitation',
    description:
      'Attach an explicit citation (CFI anchor + snippet) to the current assistant reply. Call this when you want to point the user at a passage you remembered without re-searching.',
    permission: 'read',
    parallelSafe: true,
    inputSchema,
    async run(args) {
      await onCite({
        cfi: args.cfi,
        endCfi: args.endCfi,
        snippet: args.snippet,
        chapterTitle: args.chapterTitle,
        sectionIndex: args.sectionIndex,
      });
      return { ok: true };
    },
  };
}
