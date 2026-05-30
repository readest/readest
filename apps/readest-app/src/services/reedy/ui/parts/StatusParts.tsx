'use client';

import { AlertTriangle, Ban } from 'lucide-react';
import type { ReedyMessagePart } from '../../store/reedyStore';

export function ErrorPart({ part }: { part: Extract<ReedyMessagePart, { type: 'error' }> }) {
  return (
    <div className='border-warning/30 bg-warning/10 my-1 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px]'>
      <AlertTriangle className='text-warning mt-0.5 size-3 shrink-0' />
      <div className='flex min-w-0 flex-col gap-0.5'>
        <div className='text-warning font-medium'>Error · {part.kind}</div>
        <div className='text-base-content/70'>{part.message}</div>
      </div>
    </div>
  );
}

export function AbortPart({ part }: { part: Extract<ReedyMessagePart, { type: 'abort' }> }) {
  return (
    <div className='border-base-content/10 bg-base-200/40 my-1 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]'>
      <Ban className='text-base-content/60 size-3 shrink-0' />
      <span className='text-base-content/70'>
        {part.partial ? 'Aborted (partial reply)' : 'Aborted'}
      </span>
    </div>
  );
}
