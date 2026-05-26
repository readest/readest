'use client';

import { useCallback, useRef } from 'react';
import type { AgentRuntime, RunTurnInput } from '../runtime/AgentRuntime';
import type { ReedyEvent } from '../runtime/events';
import { useReedyStore } from '../store/reedyStore';

/**
 * Drives one assistant turn through the AgentRuntime, dispatching every
 * ReedyEvent the runtime yields into the Reedy store (Phase 4.1).
 *
 * Why a hook and not a method on the store: the runtime is constructed
 * by the notebook with per-book deps (model, tools, layers). The store
 * stays runtime-agnostic; the hook is the glue.
 */
export function useReedyTurn(runtime: AgentRuntime | null) {
  const cancelRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (args: { sessionId: string; bookHash: string; userMessage: string }): Promise<void> => {
      if (!runtime) return;
      // Cancel any in-flight turn before starting a new one so we never
      // have two AgentRuntime streams mutating the same active message.
      cancelRef.current?.abort();
      const controller = new AbortController();
      cancelRef.current = controller;

      const store = useReedyStore.getState();
      store.startUserTurn(args.userMessage);

      const turnInput: RunTurnInput = {
        sessionId: args.sessionId,
        bookHash: args.bookHash,
        userMessage: args.userMessage,
        signal: controller.signal,
      };

      // The first event the runtime yields is `turn_start` carrying the
      // assistantMessageId. Wait for it before pushing the assistant
      // message into the store so the store has a stable id to mutate.
      let assistantStarted = false;
      try {
        for await (const event of runtime.runTurn(turnInput) as AsyncIterable<ReedyEvent>) {
          if (!assistantStarted && event.type === 'turn_start') {
            store.startAssistantTurn(event.assistantMessageId, controller);
            assistantStarted = true;
            continue;
          }
          if (!assistantStarted) {
            // Defensive: the runtime contract guarantees turn_start first,
            // but if something upstream changes don't drop subsequent events.
            store.startAssistantTurn('msg-fallback', controller);
            assistantStarted = true;
          }
          store.applyEvent(event);
          if (event.type === 'done') break;
        }
      } finally {
        store.finishTurn();
        if (cancelRef.current === controller) cancelRef.current = null;
      }
    },
    [runtime],
  );

  const abort = useCallback(() => {
    cancelRef.current?.abort();
  }, []);

  return { send, abort };
}
