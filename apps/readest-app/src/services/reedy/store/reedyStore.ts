import { create } from 'zustand';
import type { ReedyEvent, ReedyTurnOutput } from '../runtime/events';
import type { ReedyToolError } from '../runtime/errors';

/**
 * Reedy chat store (Phase 4.1).
 *
 * Holds the per-session message log the agent UI renders. Distinct from
 * the MVP `useAIChatStore` so the two paths never share state — switching
 * `aiSettings.reedy.runtime` mid-session shouldn't corrupt either log.
 *
 * Messages are stored as ordered arrays of structured parts produced by
 * the AgentRuntime's ReedyEvent stream. The store has no opinions about
 * persistence — sessions today live in-memory only; Phase 6+ wires up
 * disk storage if the agent path graduates beyond the measurement plan.
 */

export type ReedyMessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: unknown;
      permission: 'read' | 'navigate' | 'write';
      state: 'pending' | 'ok' | 'error';
      result?: unknown;
      error?: ReedyToolError;
      durationMs?: number;
    }
  | {
      type: 'citation';
      cfi: string;
      sectionIndex: number;
      chapterTitle?: string;
      snippet: string;
    }
  | { type: 'error'; message: string; kind: string }
  | { type: 'abort'; partial: boolean };

export interface ReedyUserMessage {
  id: string;
  role: 'user';
  text: string;
  createdAt: number;
}

export interface ReedyAssistantMessage {
  id: string;
  role: 'assistant';
  parts: ReedyMessagePart[];
  createdAt: number;
  /** Set once the runtime emits `done`. */
  finishReason?: ReedyTurnOutput['finishReason'];
  usage?: ReedyTurnOutput['usage'];
}

export type ReedyMessage = ReedyUserMessage | ReedyAssistantMessage;

export interface ReedyStoreState {
  messages: ReedyMessage[];
  /** True while a turn is being processed by the runtime. */
  isRunning: boolean;
  /** The active turn's assistantMessageId so we know which message to mutate on each event. */
  activeAssistantMessageId: string | null;
  /** AbortController for the active turn; the Composer's Stop button calls .abort(). */
  abortController: AbortController | null;

  // Mutations
  startUserTurn: (text: string) => void;
  startAssistantTurn: (assistantMessageId: string, controller: AbortController) => void;
  applyEvent: (event: ReedyEvent) => void;
  finishTurn: () => void;
  reset: () => void;
}

export const useReedyStore = create<ReedyStoreState>((set, get) => ({
  messages: [],
  isRunning: false,
  activeAssistantMessageId: null,
  abortController: null,

  startUserTurn(text) {
    const msg: ReedyUserMessage = {
      id: randomId('user'),
      role: 'user',
      text,
      createdAt: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, msg], isRunning: true }));
  },

  startAssistantTurn(assistantMessageId, controller) {
    const msg: ReedyAssistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      parts: [],
      createdAt: Date.now(),
    };
    set((s) => ({
      messages: [...s.messages, msg],
      activeAssistantMessageId: assistantMessageId,
      abortController: controller,
    }));
  },

  applyEvent(event) {
    const id = get().activeAssistantMessageId;
    if (!id) return;
    set((s) => ({ messages: applyEventToMessages(s.messages, id, event) }));
  },

  finishTurn() {
    set({ isRunning: false, activeAssistantMessageId: null, abortController: null });
  },

  reset() {
    set({
      messages: [],
      isRunning: false,
      activeAssistantMessageId: null,
      abortController: null,
    });
  },
}));

// ---------------------------------------------------------------------------
// pure helpers — exported so tests can target the reducer without React.
// ---------------------------------------------------------------------------

export function applyEventToMessages(
  messages: ReedyMessage[],
  assistantMessageId: string,
  event: ReedyEvent,
): ReedyMessage[] {
  const idx = messages.findIndex((m) => m.id === assistantMessageId && m.role === 'assistant');
  if (idx === -1) return messages;
  const current = messages[idx] as ReedyAssistantMessage;
  const next = applyEventToAssistant(current, event);
  if (next === current) return messages;
  const out = messages.slice();
  out[idx] = next;
  return out;
}

function applyEventToAssistant(
  msg: ReedyAssistantMessage,
  event: ReedyEvent,
): ReedyAssistantMessage {
  switch (event.type) {
    case 'text_delta':
      return appendOrExtendText(msg, event.delta);
    case 'tool_call':
      return {
        ...msg,
        parts: [
          ...msg.parts,
          {
            type: 'tool_call',
            id: event.id,
            name: event.name,
            args: event.args,
            permission: event.permission,
            state: 'pending',
          },
        ],
      };
    case 'tool_result':
      return {
        ...msg,
        parts: msg.parts.map((p) => {
          if (p.type !== 'tool_call' || p.id !== event.id) return p;
          if (event.ok) {
            return {
              ...p,
              state: 'ok',
              result: event.result,
              durationMs: event.durationMs,
            };
          }
          return { ...p, state: 'error', error: event.error };
        }),
      };
    case 'citation':
      return {
        ...msg,
        parts: [
          ...msg.parts,
          {
            type: 'citation',
            cfi: event.cfi,
            sectionIndex: event.sectionIndex,
            chapterTitle: event.chapterTitle,
            snippet: event.snippet,
          },
        ],
      };
    case 'error':
      return {
        ...msg,
        parts: [...msg.parts, { type: 'error', message: event.message, kind: event.kind }],
      };
    case 'abort':
      return {
        ...msg,
        parts: [...msg.parts, { type: 'abort', partial: event.partial }],
      };
    case 'done':
      return { ...msg, finishReason: event.output.finishReason, usage: event.output.usage };
    case 'turn_start':
    case 'step_finish':
    case 'usage':
    case 'memory_write':
      // No structural-part mutation today. Phase 4 follow-up may want a
      // separate ReasoningPart or MemoryNotePart; the store would gain
      // a new branch then.
      return msg;
    default:
      return msg;
  }
}

function appendOrExtendText(msg: ReedyAssistantMessage, delta: string): ReedyAssistantMessage {
  if (delta.length === 0) return msg;
  const last = msg.parts.at(-1);
  // Coalesce consecutive text deltas into one text part so the UI
  // re-renders the same React node instead of inflating the parts array.
  if (last && last.type === 'text') {
    const updated = { ...last, text: last.text + delta };
    return { ...msg, parts: [...msg.parts.slice(0, -1), updated] };
  }
  return { ...msg, parts: [...msg.parts, { type: 'text', text: delta }] };
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
