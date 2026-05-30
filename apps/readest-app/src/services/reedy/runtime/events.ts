import type { ReedyErrorKind, ReedyToolError } from './errors';

/**
 * Permission level a tool requires before the runtime invokes it. Matches
 * the ToolRegistry's `permission` field (Phase 2.3). Read-only tools are
 * auto-approved; navigate prompts once per session per the v1 UX in §10;
 * write prompts inline.
 */
export type PermissionLevel = 'read' | 'navigate' | 'write';

/**
 * Discriminated union of everything `AgentRuntime.runTurn()` yields.
 * See §6 of the planning doc for the canonical contract; the agent UI in
 * Phase 4 consumes this stream and dispatches store updates per event.
 */
export type ReedyEvent =
  | { type: 'turn_start'; sessionId: string; assistantMessageId: string }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: unknown;
      permission: PermissionLevel;
    }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: true;
      result: unknown;
      durationMs: number;
    }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: false;
      error: ReedyToolError;
    }
  | {
      type: 'citation';
      cfi: string;
      sectionIndex: number;
      chapterTitle?: string;
      snippet: string;
    }
  | { type: 'memory_write'; scope: 'user' | 'book'; key: string; summary: string }
  | { type: 'step_finish'; step: number; reason: 'stop' | 'tool-calls' | 'length' }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'error'; kind: ReedyErrorKind; message: string; retryable: boolean }
  | { type: 'abort'; partial: boolean }
  | { type: 'done'; output: ReedyTurnOutput };

export interface ReedyTurnOutput {
  sessionId: string;
  assistantMessageId: string;
  finishReason: 'stop' | 'length' | 'tool-error' | 'abort' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

// ---------------------------------------------------------------------------
// Factories — keeping the call sites in streamLoop terse and refactor-safe.
// ---------------------------------------------------------------------------

export const events = {
  turnStart(sessionId: string, assistantMessageId: string): ReedyEvent {
    return { type: 'turn_start', sessionId, assistantMessageId };
  },
  textDelta(delta: string): ReedyEvent {
    return { type: 'text_delta', delta };
  },
  toolCall(args: {
    id: string;
    name: string;
    args: unknown;
    permission: PermissionLevel;
  }): ReedyEvent {
    return { type: 'tool_call', ...args };
  },
  toolResultOk(args: {
    id: string;
    name: string;
    result: unknown;
    durationMs: number;
  }): ReedyEvent {
    return { type: 'tool_result', ok: true, ...args };
  },
  toolResultErr(args: { id: string; name: string; error: ReedyToolError }): ReedyEvent {
    return { type: 'tool_result', ok: false, ...args };
  },
  citation(args: {
    cfi: string;
    sectionIndex: number;
    chapterTitle?: string;
    snippet: string;
  }): ReedyEvent {
    return { type: 'citation', ...args };
  },
  memoryWrite(scope: 'user' | 'book', key: string, summary: string): ReedyEvent {
    return { type: 'memory_write', scope, key, summary };
  },
  stepFinish(step: number, reason: 'stop' | 'tool-calls' | 'length'): ReedyEvent {
    return { type: 'step_finish', step, reason };
  },
  usage(promptTokens: number, completionTokens: number): ReedyEvent {
    return { type: 'usage', promptTokens, completionTokens };
  },
  error(kind: ReedyErrorKind, message: string, retryable: boolean): ReedyEvent {
    return { type: 'error', kind, message, retryable };
  },
  abort(partial: boolean): ReedyEvent {
    return { type: 'abort', partial };
  },
  done(output: ReedyTurnOutput): ReedyEvent {
    return { type: 'done', output };
  },
};
