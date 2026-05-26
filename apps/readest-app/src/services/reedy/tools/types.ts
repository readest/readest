import type { z } from 'zod';
import type { PermissionLevel } from '../runtime/events';

export type { PermissionLevel };

/**
 * Per-call context handed to every tool. The runtime constructs one of
 * these per assistant turn and shares it across every tool dispatched in
 * that turn (per Phase 2.6 streamLoop).
 */
export interface ToolContext {
  /** The book the user has open. Tools may scope retrieval / writes to this. */
  bookHash: string;
  /** The Reedy session id (one session = one conversation thread). */
  sessionId: string;
  /** The assistant message currently being produced. */
  assistantMessageId: string;
  /** Abort signal for the whole turn; tools must wire it through. */
  signal: AbortSignal;
  /**
   * Prompt the user for permission to run a write/navigate tool. Resolves
   * true if approved, false if denied. Read-only tools never call this.
   */
  requestPermission(args: { tool: string; description: string; args: unknown }): Promise<boolean>;
}

/**
 * Generic tool contract every Reedy tool implements. Wraps the Vercel SDK's
 * tool({...}) shape with the metadata the runtime needs (permission,
 * parallelSafe, timeoutMs) so the streamLoop can enforce policy
 * uniformly without per-tool special-casing.
 */
export interface ReedyTool<TArgs = unknown, TResult = unknown> {
  /** Stable identifier the model sees in the tool catalog. */
  readonly name: string;
  /** One-line description shown to the model; used in the tool catalog layer. */
  readonly description: string;
  /** Permission tier the runtime gates the call behind. */
  readonly permission: PermissionLevel;
  /**
   * When false the registry/runtime serializes concurrent calls to this
   * tool within one step. Most read tools are parallel-safe; navigate /
   * write tools usually aren't.
   */
  readonly parallelSafe: boolean;
  /** Per-call wall-clock budget; the registry enforces via AbortController. */
  readonly timeoutMs?: number;
  /** Zod schema for the tool's args. The registry validates before run(). */
  readonly inputSchema: z.ZodType<TArgs>;
  run(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

/**
 * The shape the runtime needs back from registry.invoke() for each tool
 * call so it can emit the corresponding ReedyEvent.
 */
export interface ToolInvocation<TResult = unknown> {
  ok: true;
  result: TResult;
  durationMs: number;
}
