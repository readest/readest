import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { ReadingContextSnapshot } from './types';

const inputSchema = z.object({});

export interface GetSelectionResult {
  selection: NonNullable<ReadingContextSnapshot['selection']> | null;
}

/**
 * Returns the user's active text selection if any, or null otherwise.
 * Narrower than getReadingContext — exists so the agent can pin a
 * quoted-passage interaction (right-click "Ask Reedy about this") without
 * having to fetch full reading state.
 */
export function createGetSelectionTool(
  provider: () => ReadingContextSnapshot['selection'] | null,
): ReedyTool<z.input<typeof inputSchema>, GetSelectionResult> {
  return {
    name: 'getSelection',
    description:
      "Get the user's currently selected text in the book (with start and end CFI anchors). Returns null if nothing is selected. Use this when the user references something they highlighted.",
    permission: 'read',
    parallelSafe: true,
    inputSchema,
    async run() {
      return { selection: provider() ?? null };
    },
  };
}
