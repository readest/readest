'use client';

import { useEffect, useRef, useState } from 'react';
import { VList, type VListHandle } from 'virtua';
import type { ReedyMessage } from '../store/reedyStore';
import { MessageCard } from './MessageCard';

/**
 * Virtua-virtualized thread scroller (Phase 4.2.b).
 *
 * Owns auto-scroll engagement: pinned to the bottom on initial mount
 * and after every store update while the user hasn't actively scrolled
 * away. Pointer/wheel/touch interactions disengage; scrolling back to
 * the bottom (or sending a new message) re-engages.
 */
export function AgentThread({
  messages,
  isRunning,
  onSourceClick,
  emptyState,
}: {
  messages: ReedyMessage[];
  isRunning: boolean;
  onSourceClick?: (cfi: string) => void;
  emptyState?: React.ReactNode;
}) {
  const ref = useRef<VListHandle>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Pin to the bottom whenever the message count grows (new turn, new
  // assistant message, new structural part) AND we're in autoScroll mode.
  useEffect(() => {
    if (!autoScroll || messages.length === 0) return;
    const lastIndex = messages.length - 1;
    requestAnimationFrame(() => {
      ref.current?.scrollToIndex(lastIndex, { align: 'end' });
    });
  }, [messages.length, autoScroll, messages]);

  // Disengage auto-scroll when the user actively scrolls; re-engage when
  // they reach the bottom again.
  const handleScroll = (offset: number): void => {
    const handle = ref.current;
    if (!handle) return;
    const total = handle.scrollSize;
    const view = handle.viewportSize;
    const atBottom = total - (offset + view) < 24;
    setAutoScroll(atBottom);
  };

  if (messages.length === 0 && emptyState) {
    return <div className='flex h-full items-center justify-center'>{emptyState}</div>;
  }

  return (
    <VList ref={ref} className='reedy-agent-thread h-full w-full' onScroll={handleScroll}>
      {messages.map((m) => (
        <MessageCard key={m.id} message={m} onSourceClick={onSourceClick} />
      ))}
      {isRunning && messages.length > 0 && (
        <div className='text-base-content/40 mb-4 px-3 text-[11px] italic'>Reedy is thinking…</div>
      )}
    </VList>
  );
}
