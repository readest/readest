'use client';

import { useState } from 'react';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { ReedyMessagePart } from '../../store/reedyStore';

/**
 * Renders a tool_call message part as a collapsed pill. Click to expand
 * the args + result. Pending tools show a spinner; finished tools show
 * a check (ok) or warning (error) and the duration if available.
 *
 * The plan calls for an inline approval UI when permission != 'read';
 * the runtime's ToolRegistry already enforces approvals via its
 * requestPermission callback, so that prompt fires at registry-invoke
 * time. The pill stays informational.
 */
export function ToolCallPart({ part }: { part: Extract<ReedyMessagePart, { type: 'tool_call' }> }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon =
    part.state === 'pending' ? (
      <Loader2 className='size-3 animate-spin' />
    ) : part.state === 'error' ? (
      <AlertCircle className='text-warning size-3' />
    ) : (
      <CheckCircle2 className='text-success size-3' />
    );

  return (
    <div className='border-base-content/10 bg-base-200/50 my-1 rounded-md border px-2 py-1.5 text-[11px]'>
      <button
        type='button'
        onClick={() => setExpanded((e) => !e)}
        className='flex w-full items-center gap-1.5 text-start'
      >
        {expanded ? <ChevronDown className='size-3' /> : <ChevronRight className='size-3' />}
        <Wrench className='text-base-content/60 size-3' />
        <span className='text-base-content font-medium'>{part.name}</span>
        {statusIcon}
        {part.durationMs !== undefined && (
          <span className='text-base-content/40 ms-auto text-[10px]'>{part.durationMs}ms</span>
        )}
      </button>
      {expanded && (
        <div className='mt-1.5 space-y-1'>
          <div>
            <div className='text-base-content/40 mb-0.5 text-[10px] uppercase'>args</div>
            <pre className='bg-base-300/40 max-h-40 overflow-auto rounded px-1.5 py-1 font-mono text-[10px] whitespace-pre-wrap'>
              {safeStringify(part.args)}
            </pre>
          </div>
          {part.state === 'ok' && part.result !== undefined && (
            <div>
              <div className='text-base-content/40 mb-0.5 text-[10px] uppercase'>result</div>
              <pre className='bg-base-300/40 max-h-60 overflow-auto rounded px-1.5 py-1 font-mono text-[10px] whitespace-pre-wrap'>
                {safeStringify(part.result)}
              </pre>
            </div>
          )}
          {part.state === 'error' && part.error && (
            <div>
              <div className='text-error mb-0.5 text-[10px] uppercase'>
                error · {part.error.kind}
              </div>
              <pre className='text-error/80 bg-base-300/40 rounded px-1.5 py-1 font-mono text-[10px] whitespace-pre-wrap'>
                {part.error.message}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
