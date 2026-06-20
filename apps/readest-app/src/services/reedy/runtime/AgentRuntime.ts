import { streamText, stepCountIs, type ModelMessage } from 'ai';
import type { ChatModel } from '../models/ChatModel';
import type { PromptLayer, BuiltContext } from '../context';
import { buildPromptContext } from '../context';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type { ToolContext } from '../tools/types';
import { events, type ReedyEvent, type ReedyTurnOutput } from './events';
import { isAbortError } from './abort';
import { ReedyToolError } from './errors';

const DEFAULT_MAX_STEPS = 8;

/**
 * Per-turn input the runtime needs. `sessionId` + `assistantMessageId`
 * thread the turn through downstream persistence (Phase 3+); the
 * runtime itself stays stateless beyond the per-turn ToolContext.
 */
export interface RunTurnInput {
  sessionId: string;
  bookHash: string;
  userMessage: string;
  /**
   * Prior message history to seed the conversation. The runtime adds the
   * user message itself; pass everything before it. Defaults to [].
   */
  history?: ModelMessage[];
  /**
   * Optional assistant message id. Generated if not provided so callers
   * who don't need stable ids (tests) don't have to make one up.
   */
  assistantMessageId?: string;
  /** Caller signal — runtime composes with its own so tools see both. */
  signal?: AbortSignal;
  /**
   * Optional per-turn tool-name allowlist. When provided, only tools
   * whose name appears here are exposed to the model. Used by the
   * notebook to honor the active skill's `tool_allowlist`. Null or
   * undefined means every registered tool is available.
   */
  toolAllowlist?: readonly string[] | null;
}

/**
 * Synthesized citation event the runtime emits when a tool result
 * implies one. `extractCitations` is the customization point.
 */
export interface CitationLike {
  cfi: string;
  sectionIndex: number;
  chapterTitle?: string;
  snippet: string;
}

export interface AgentRuntimeOptions {
  model: ChatModel;
  tools: ToolRegistry;
  /**
   * PromptLayers the runtime composes into the system message. Pass
   * factories that resolve current state at runTurn() time (e.g.
   * ReadingLayer wraps the latest snapshot). The runtime doesn't own
   * layer construction — callers wire whatever applies.
   */
  layers: PromptLayer[];
  /** Cap on agent steps inside one turn. @default 8 */
  maxSteps?: number;
  /** Optional per-call permission prompt; defaults to read auto-approve, others deny. */
  requestPermission?: ToolContext['requestPermission'];
  /**
   * Optional citation extractor — called for every successful tool
   * result. Returning an array of citations causes the runtime to emit
   * a `{ type: 'citation', ... }` event per item. Defaults to extracting
   * from lookupPassage-shaped results.
   */
  extractCitations?: (toolName: string, result: unknown) => CitationLike[];
}

/**
 * Composes ChatModel + ToolRegistry + PromptContextBuilder into one
 * runTurn() entrypoint that streams ReedyEvents (per plan §6 / §2.6).
 *
 * The runtime owns the per-turn glue (build system prompt, construct
 * ToolContext, dispatch streamText, fan TextStreamParts out as
 * ReedyEvents) but stays stateless — sessions, persistence, memory
 * writes are wired in by callers (Phase 3+ services hook in via
 * extractCitations / history / requestPermission).
 *
 * Vercel SDK does the multi-step tool loop internally via
 * stopWhen=stepCountIs(maxSteps); we walk fullStream once and map each
 * part to a ReedyEvent without re-implementing the dispatch loop. The
 * plan reserves a per-step outer loop for memory-write checkpoints —
 * defer that until Phase 3 actually surfaces a hook.
 */
export class AgentRuntime {
  private readonly maxSteps: number;

  constructor(private readonly opts: AgentRuntimeOptions) {
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  runTurn(input: RunTurnInput): AsyncIterable<ReedyEvent> {
    return this.runTurnGenerator(input);
  }

  private async *runTurnGenerator(input: RunTurnInput): AsyncIterable<ReedyEvent> {
    const assistantMessageId = input.assistantMessageId ?? randomId('msg');
    yield events.turnStart(input.sessionId, assistantMessageId);

    // Build the system prompt and the ToolContext the registry will hand
    // to every tool dispatched in this turn.
    let ctx: BuiltContext;
    try {
      ctx = buildPromptContext({ model: this.opts.model, layers: this.opts.layers });
    } catch (err) {
      yield events.error('unknown', `failed to build prompt context: ${stringifyErr(err)}`, false);
      yield events.done({
        sessionId: input.sessionId,
        assistantMessageId,
        finishReason: 'error',
      });
      return;
    }

    const toolCtx: ToolContext = {
      bookHash: input.bookHash,
      sessionId: input.sessionId,
      assistantMessageId,
      signal: input.signal ?? new AbortController().signal,
      // ToolRegistry only invokes requestPermission for non-read tools, so
      // the default here is reached only when the caller didn't supply a
      // prompt — in which case we deny rather than silently writing /
      // navigating without explicit user consent.
      requestPermission: this.opts.requestPermission ?? (async (): Promise<boolean> => false),
    };

    const messages: ModelMessage[] = [
      ...(input.history ?? []),
      { role: 'user', content: input.userMessage },
    ];

    let lastUsage: { promptTokens: number; completionTokens: number } | undefined;
    let lastFinishReason: ReedyTurnOutput['finishReason'] = 'stop';
    let aborted = false;
    const extractCitations = this.opts.extractCitations ?? defaultExtractCitations;

    try {
      const result = streamText({
        model: this.opts.model.getLanguageModel(),
        system: ctx.system,
        messages,
        tools: this.buildToolSet(toolCtx, input.toolAllowlist),
        stopWhen: stepCountIs(this.maxSteps),
        abortSignal: input.signal,
      });

      let stepIndex = 0;
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            if (part.text.length > 0) yield events.textDelta(part.text);
            break;
          case 'tool-call':
            yield events.toolCall({
              id: part.toolCallId,
              name: part.toolName,
              args: part.input,
              permission: this.opts.tools.get(part.toolName)?.permission ?? 'read',
            });
            break;
          case 'tool-result': {
            const toolName = part.toolName;
            yield events.toolResultOk({
              id: part.toolCallId,
              name: toolName,
              result: part.output,
              durationMs: 0, // Vercel doesn't surface tool duration here; runtime
              // can compute it from start-step + finish-step if needed.
            });
            // Synthesize citation events from the tool result.
            for (const c of extractCitations(toolName, part.output)) {
              yield events.citation(c);
            }
            break;
          }
          case 'tool-error': {
            const err =
              part.error instanceof ReedyToolError
                ? part.error
                : new ReedyToolError(stringifyErr(part.error), {
                    kind: 'tool_runtime_error',
                    toolName: part.toolName,
                    cause: part.error,
                  });
            yield events.toolResultErr({
              id: part.toolCallId,
              name: part.toolName,
              error: err,
            });
            break;
          }
          case 'finish-step':
            yield events.stepFinish(stepIndex, normaliseFinishReason(part.finishReason));
            if (part.usage) {
              lastUsage = {
                promptTokens: part.usage.inputTokens ?? 0,
                completionTokens: part.usage.outputTokens ?? 0,
              };
              yield events.usage(lastUsage.promptTokens, lastUsage.completionTokens);
            }
            stepIndex++;
            break;
          case 'finish':
            lastFinishReason = normaliseTurnFinish(part.finishReason);
            if (part.totalUsage) {
              lastUsage = {
                promptTokens: part.totalUsage.inputTokens ?? 0,
                completionTokens: part.totalUsage.outputTokens ?? 0,
              };
            }
            break;
          case 'abort':
            aborted = true;
            break;
          case 'error':
            yield events.error('model_error', stringifyErr(part.error), true);
            lastFinishReason = 'error';
            break;
          default:
            // text-start / text-end / reasoning / source / file / start /
            // start-step / tool-input-* / tool-output-denied are not
            // load-bearing for the v1 event stream.
            break;
        }
      }
    } catch (err) {
      if (isAbortError(err) || input.signal?.aborted) {
        aborted = true;
      } else {
        yield events.error('model_error', stringifyErr(err), true);
        lastFinishReason = 'error';
      }
    }

    if (aborted) {
      yield events.abort(/* partial */ true);
      lastFinishReason = 'abort';
    }

    yield events.done({
      sessionId: input.sessionId,
      assistantMessageId,
      finishReason: lastFinishReason,
      usage: lastUsage,
    });
  }

  /**
   * Build the Vercel ToolSet for this turn, applying the per-turn
   * allowlist (active skill's `tool_allowlist`) if one was supplied.
   * Returns undefined when no tools end up exposed, so streamText skips
   * tool-call wiring entirely instead of advertising an empty catalog.
   */
  private buildToolSet(
    ctx: ToolContext,
    allowlist: readonly string[] | null | undefined,
  ): ReturnType<ToolRegistry['toVercelToolSet']> | undefined {
    const all = this.opts.tools.list();
    if (all.length === 0) return undefined;
    if (allowlist == null) return this.opts.tools.toVercelToolSet(ctx);
    const allowedNames = new Set(allowlist);
    const overlap = all.filter((t) => allowedNames.has(t.name));
    if (overlap.length === 0) return undefined;
    return this.opts.tools.toVercelToolSet(ctx, { allowlist });
  }
}

function defaultExtractCitations(toolName: string, result: unknown): CitationLike[] {
  if (toolName === 'lookupPassage' && result && typeof result === 'object') {
    const r = result as {
      passages?: Array<{
        cfi?: string;
        chapter?: string;
        sectionIndex?: number;
        text?: string;
      }>;
    };
    if (!Array.isArray(r.passages)) return [];
    return r.passages
      .filter((p) => p.cfi && typeof p.text === 'string')
      .map((p) => ({
        cfi: p.cfi!,
        sectionIndex: p.sectionIndex ?? 0,
        chapterTitle: p.chapter,
        snippet: (p.text ?? '').slice(0, 200),
      }));
  }
  if (toolName === 'addCitation' && result && typeof result === 'object') {
    // addCitation acks via { ok: true }; the citation was already pushed
    // through its onCite callback. No additional event needed here.
    return [];
  }
  return [];
}

function normaliseFinishReason(reason: string): 'stop' | 'tool-calls' | 'length' {
  if (reason === 'tool-calls') return 'tool-calls';
  if (reason === 'length') return 'length';
  return 'stop';
}

function normaliseTurnFinish(reason: string): ReedyTurnOutput['finishReason'] {
  if (reason === 'length') return 'length';
  if (reason === 'tool-calls') return 'tool-error';
  if (reason === 'error') return 'error';
  return 'stop';
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
