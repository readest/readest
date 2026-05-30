'use client';

import { memo } from 'react';
import type { ReedyMessage, ReedyMessagePart } from '../store/reedyStore';
import { AssistantTextPart, UserTextPart } from './parts/TextPart';
import { ToolCallPart } from './parts/ToolCallPart';
import { CitationPart } from './parts/CitationPart';
import { AbortPart, ErrorPart } from './parts/StatusParts';

/**
 * One row in the agent thread. User messages render as a single text
 * bubble; assistant messages dispatch each structural part to its
 * dedicated renderer (text, tool_call, citation, error, abort).
 *
 * Memoized on the message reference — the store reducer creates a new
 * object only for messages that mutate this tick, so unchanged rows
 * skip the entire React subtree.
 */
export const MessageCard = memo(function MessageCard({
  message,
  onSourceClick,
}: {
  message: ReedyMessage;
  onSourceClick?: (cfi: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className='animate-in fade-in mx-auto mb-3 flex w-full justify-end duration-200'>
        <div className='bg-base-200/60 text-base-content max-w-[85%] rounded-lg px-3 py-2 text-sm'>
          <UserTextPart text={message.text} />
        </div>
      </div>
    );
  }

  return (
    <div className='animate-in fade-in mb-4 flex w-full duration-200'>
      <div className='flex w-full min-w-0 flex-col gap-1'>
        {message.parts.map((part, i) => (
          <PartDispatcher key={partKey(part, i)} part={part} onSourceClick={onSourceClick} />
        ))}
        {message.finishReason === 'error' && message.parts.every((p) => p.type !== 'error') && (
          <ErrorPart part={{ type: 'error', kind: 'unknown', message: 'Turn ended in error.' }} />
        )}
      </div>
    </div>
  );
});

function PartDispatcher({
  part,
  onSourceClick,
}: {
  part: ReedyMessagePart;
  onSourceClick?: (cfi: string) => void;
}) {
  switch (part.type) {
    case 'text':
      return <AssistantTextPart text={part.text} />;
    case 'tool_call':
      return <ToolCallPart part={part} />;
    case 'citation':
      return <CitationPart part={part} onClick={onSourceClick} />;
    case 'error':
      return <ErrorPart part={part} />;
    case 'abort':
      return <AbortPart part={part} />;
    default:
      return null;
  }
}

function partKey(part: ReedyMessagePart, index: number): string {
  switch (part.type) {
    case 'tool_call':
      return `tool:${part.id}`;
    case 'citation':
      return `citation:${part.cfi}:${index}`;
    case 'text':
      // Coalesced text part — index is stable once added.
      return `text:${index}`;
    case 'error':
      return `error:${index}`;
    case 'abort':
      return `abort:${index}`;
  }
}
