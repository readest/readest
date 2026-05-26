import { tool as vercelTool, type ToolSet } from 'ai';
import { makeToolError, type ReedyToolError } from '../runtime/errors';
import type { ReedyTool, ToolContext } from './types';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Registry that holds the runtime's tool catalog and adapts each tool to
 * the Vercel `ai`-SDK ToolSet `streamText` consumes (per Phase 2.3).
 *
 * The registry wraps every tool's `run()` with:
 *   - Zod input validation       → tool_invalid_args on mismatch
 *   - Permission gate            → tool_permission_denied on refusal
 *   - Per-call timeout (default 10s) → tool_timeout
 *   - AbortSignal propagation    → tool_aborted on turn cancel
 *   - Per-tool serialization     → parallelSafe=false tools queue
 *
 * Errors bubble out as `ReedyToolError` instances so the streamLoop can
 * re-emit them as `{ tool_result, ok: false, error }` events without
 * lossy string-matching.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ReedyTool>();
  private readonly chains = new Map<string, Promise<unknown>>();

  register<TArgs, TResult>(tool: ReedyTool<TArgs, TResult>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry: tool "${tool.name}" already registered`);
    }
    this.tools.set(tool.name, tool as ReedyTool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  list(): ReedyTool[] {
    return [...this.tools.values()];
  }

  get(name: string): ReedyTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Adapt every registered tool to the Vercel ToolSet shape. Each tool's
   * `execute` is wrapped per the policy above. The caller passes the
   * per-turn ToolContext once; every dispatch in that turn reuses it.
   */
  toVercelToolSet(ctx: ToolContext): ToolSet {
    const set: Record<string, unknown> = {};
    for (const t of this.tools.values()) {
      set[t.name] = vercelTool({
        description: t.description,
        inputSchema: t.inputSchema,
        execute: async (rawArgs: unknown) => {
          return this.invoke(t.name, rawArgs, ctx);
        },
      });
    }
    return set as ToolSet;
  }

  /**
   * Direct invoke path used by AgentRuntime (and tests). Returns the
   * tool's result on success; throws ReedyToolError on any failure.
   */
  async invoke<TResult = unknown>(
    name: string,
    rawArgs: unknown,
    ctx: ToolContext,
  ): Promise<TResult> {
    const t = this.tools.get(name);
    if (!t) {
      throw makeToolError('tool_unknown', name, `no tool registered under "${name}"`);
    }

    // 1. Zod validation
    const parsed = t.inputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      throw makeToolError(
        'tool_invalid_args',
        name,
        `arguments failed schema validation: ${parsed.error.message}`,
        parsed.error,
      );
    }

    // 2. Permission gate
    if (t.permission !== 'read') {
      let granted = false;
      try {
        granted = await ctx.requestPermission({
          tool: name,
          description: t.description,
          args: parsed.data,
        });
      } catch (err) {
        throw makeToolError('tool_permission_denied', name, 'permission request errored', err);
      }
      if (!granted) {
        throw makeToolError('tool_permission_denied', name, 'user denied permission');
      }
    }

    // 3. Serialize parallel-unsafe calls per-tool. We chain on whatever
    //    in-flight invocation of THIS tool exists; parallelSafe tools
    //    skip the chain and run immediately.
    if (!t.parallelSafe) {
      const prior = this.chains.get(name) ?? Promise.resolve();
      const next = prior.catch(() => undefined).then(() => runWithTimeout(t, parsed.data, ctx));
      this.chains.set(name, next);
      try {
        return (await next) as TResult;
      } finally {
        if (this.chains.get(name) === next) this.chains.delete(name);
      }
    }
    return runWithTimeout(t, parsed.data, ctx) as Promise<TResult>;
  }
}

async function runWithTimeout<TArgs, TResult>(
  t: ReedyTool<TArgs, TResult>,
  args: TArgs,
  ctx: ToolContext,
): Promise<TResult> {
  const timeoutMs = t.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Compose: external abort (from turn cancel) + local timeout.
  const localController = new AbortController();
  const onParentAbort = (): void => localController.abort();
  if (ctx.signal.aborted) localController.abort();
  else ctx.signal.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => localController.abort(), timeoutMs);

  const innerCtx: ToolContext = { ...ctx, signal: localController.signal };

  try {
    return await t.run(args, innerCtx);
  } catch (err) {
    // The tool may have thrown a domain-specific error; preserve cause
    // and classify as timeout/abort/runtime per signal state.
    if (localController.signal.aborted && !ctx.signal.aborted) {
      throw timeoutError(t.name, timeoutMs, err);
    }
    if (ctx.signal.aborted) {
      throw makeToolError('tool_aborted', t.name, 'turn aborted', err);
    }
    if (isReedyToolError(err)) throw err;
    throw makeToolError(
      'tool_runtime_error',
      t.name,
      err instanceof Error ? err.message : String(err),
      err,
    );
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener('abort', onParentAbort);
  }
}

function timeoutError(name: string, ms: number, cause: unknown): ReedyToolError {
  return makeToolError('tool_timeout', name, `${name} exceeded ${ms}ms`, cause);
}

function isReedyToolError(err: unknown): err is ReedyToolError {
  return (
    err instanceof Error && err.name === 'ReedyToolError' && 'kind' in err && 'toolName' in err
  );
}
