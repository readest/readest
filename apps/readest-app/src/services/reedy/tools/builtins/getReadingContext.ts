import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { ReadingContextSnapshot } from './types';

const inputSchema = z.object({});

/**
 * Read-only tool that returns the user's current reading position +
 * chapter title + active selection. The agent uses this when it needs
 * to ground its answer in where the user actually is, especially when
 * the user asks vague questions ("what does this mean?", "summarize the
 * last paragraph").
 */
export function createGetReadingContextTool(
  provider: () => ReadingContextSnapshot,
): ReedyTool<z.input<typeof inputSchema>, ReadingContextSnapshot> {
  return {
    name: 'getReadingContext',
    description:
      'Get the user\'s current reading position, chapter title, page number, and any active text selection. Call this when you need to answer questions about the user\'s immediate context ("this paragraph", "this chapter", etc).',
    permission: 'read',
    parallelSafe: true,
    inputSchema,
    async run() {
      return provider();
    },
  };
}
