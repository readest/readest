/**
 * Error taxonomy for the Reedy agent runtime (Appendix A · Phase 2.2).
 *
 * Three layers:
 *   - `ReedyErrorKind` enumerates everything the runtime can hit at the
 *     outer (turn-lifecycle) level: provider failures, context overflow,
 *     timeout, abort, etc.
 *   - `ReedyError` is the catch-all class — carries `kind` + `retryable`
 *     so the runtime's retry/backoff loop can decide what to do without
 *     string-matching.
 *   - `ReedyToolError` is a narrower class for tool execution failures
 *     so the streamLoop can re-emit them as `{ type: 'tool_result', ok: false }`
 *     events without losing structure.
 */

export type ReedyErrorKind =
  | 'context_overflow'
  | 'turn_timeout'
  | 'model_error'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'stream_parse'
  | 'abort'
  | 'unknown';

export interface ReedyErrorOptions {
  kind: ReedyErrorKind;
  retryable: boolean;
  cause?: unknown;
}

export class ReedyError extends Error {
  readonly kind: ReedyErrorKind;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(message: string, opts: ReedyErrorOptions) {
    super(message);
    this.name = 'ReedyError';
    this.kind = opts.kind;
    this.retryable = opts.retryable;
    this.cause = opts.cause;
  }

  /** True when the error was raised by aborting the turn via AbortSignal. */
  static isAbort(err: unknown): err is ReedyError {
    return err instanceof ReedyError && err.kind === 'abort';
  }
}

export type ReedyToolErrorKind =
  | 'tool_invalid_args' // Zod schema rejection
  | 'tool_permission_denied' // navigate / write was refused by the user
  | 'tool_timeout' // per-tool wall-clock budget hit
  | 'tool_aborted' // turn-level AbortSignal cancelled the tool call
  | 'tool_runtime_error' // tool's run() threw
  | 'tool_unknown';

export interface ReedyToolErrorOptions {
  kind: ReedyToolErrorKind;
  toolName: string;
  retryable?: boolean;
  cause?: unknown;
}

export class ReedyToolError extends Error {
  readonly kind: ReedyToolErrorKind;
  readonly toolName: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(message: string, opts: ReedyToolErrorOptions) {
    super(message);
    this.name = 'ReedyToolError';
    this.kind = opts.kind;
    this.toolName = opts.toolName;
    // Default: only invalid args + transient timeouts are retryable; the
    // model can correct its own call without intervention.
    this.retryable =
      opts.retryable ?? (opts.kind === 'tool_invalid_args' || opts.kind === 'tool_timeout');
    this.cause = opts.cause;
  }
}

// ---------------------------------------------------------------------------
// Factories (used by streamLoop / ToolRegistry — see Phase 2.6 / 2.3)
// ---------------------------------------------------------------------------

export function makeReedyError(
  kind: ReedyErrorKind,
  message: string,
  opts: { retryable?: boolean; cause?: unknown } = {},
): ReedyError {
  const defaultRetryable: Record<ReedyErrorKind, boolean> = {
    context_overflow: true,
    turn_timeout: false,
    model_error: true,
    provider_unavailable: true,
    invalid_response: false,
    stream_parse: false,
    abort: false,
    unknown: false,
  };
  return new ReedyError(message, {
    kind,
    retryable: opts.retryable ?? defaultRetryable[kind],
    cause: opts.cause,
  });
}

export function makeToolError(
  kind: ReedyToolErrorKind,
  toolName: string,
  message: string,
  cause?: unknown,
): ReedyToolError {
  return new ReedyToolError(message, { kind, toolName, cause });
}
