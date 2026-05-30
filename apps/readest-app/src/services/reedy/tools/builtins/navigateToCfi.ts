import { z } from 'zod';
import type { ReedyTool } from '../types';
import type { NavigateResult } from './types';

const inputSchema = z.object({
  cfi: z.string().min(1),
});

/**
 * Navigate the reader to a specific CFI. Marked `permission: 'navigate'`
 * so the ToolRegistry's permission gate prompts the user before the
 * first call per session (per §10's v1 UX).
 *
 * `parallelSafe: false` — only one navigate may be in flight at a time so
 * later calls in the same turn don't yank the view mid-scroll.
 */
export function createNavigateToCfiTool(
  navigate: (cfi: string) => Promise<NavigateResult>,
): ReedyTool<z.input<typeof inputSchema>, NavigateResult> {
  return {
    name: 'navigateToCfi',
    description:
      "Navigate the reader to a specific CFI location in the user's currently open book. Useful when the user asks 'take me to chapter 3' or 'show me where Alice meets the rabbit'.",
    permission: 'navigate',
    parallelSafe: false,
    inputSchema,
    async run(args) {
      return navigate(args.cfi);
    },
  };
}
