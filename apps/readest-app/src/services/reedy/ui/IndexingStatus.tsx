'use client';

import { BookOpenIcon, Loader2Icon, RotateCw, AlertTriangle } from 'lucide-react';

export type IndexingPhase = 'idle' | 'indexing' | 'indexed' | 'failed' | 'empty';

export interface IndexingStatusProps {
  status: IndexingPhase;
  /** Phase-specific progress: 0–100 for indexing, omitted otherwise. */
  progressPercent?: number;
  /** Number of chunks processed vs total — shown inline while indexing. */
  chunkProgress?: { current: number; total: number };
  /** Error text shown when status='failed'. */
  errorMessage?: string;
  onIndex?: () => void;
  onReindex?: () => void;
  onCancel?: () => void;
}

/**
 * Top-of-thread status bar (Phase 4.2.h). Surfaces the book's indexing
 * lifecycle and offers the corresponding action button.
 */
export function IndexingStatus({
  status,
  progressPercent,
  chunkProgress,
  errorMessage,
  onIndex,
  onReindex,
  onCancel,
}: IndexingStatusProps) {
  if (status === 'idle') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-primary/10 rounded-full p-3'>
          <BookOpenIcon className='text-primary size-6' />
        </div>
        <div>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>Index this book</h3>
          <p className='text-base-content/60 text-xs'>Enable agent search + chat for this book.</p>
        </div>
        <button className='btn btn-primary btn-sm h-8 text-xs' onClick={onIndex}>
          <BookOpenIcon className='me-1.5 size-3.5' />
          Start indexing
        </button>
      </div>
    );
  }

  if (status === 'indexing') {
    const pct = progressPercent ?? 0;
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <div>
          <p className='text-base-content mb-1 text-sm font-medium'>Indexing book…</p>
          <p className='text-base-content/60 text-xs'>
            {chunkProgress
              ? `${chunkProgress.current} / ${chunkProgress.total} chunks`
              : 'Preparing…'}
          </p>
        </div>
        <div className='bg-base-200 h-1.5 w-32 overflow-hidden rounded-full'>
          <div
            className='bg-primary h-full transition-all duration-300'
            style={{ width: `${pct}%` }}
          />
        </div>
        {onCancel && (
          <button className='btn btn-ghost btn-xs text-xs' onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <div className='bg-warning/10 rounded-full p-3'>
          <AlertTriangle className='text-warning size-6' />
        </div>
        <div>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>Indexing failed</h3>
          <p className='text-base-content/60 text-xs'>{errorMessage ?? 'Unknown error.'}</p>
        </div>
        <button className='btn btn-outline btn-sm h-8 text-xs' onClick={onReindex}>
          <RotateCw className='me-1.5 size-3.5' />
          Retry indexing
        </button>
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <BookOpenIcon className='text-base-content/40 size-6' />
        <div>
          <h3 className='text-base-content mb-0.5 text-sm font-medium'>No extractable text</h3>
          <p className='text-base-content/60 text-xs'>
            This book contains no extractable text (likely an image-only PDF or scanned book). Reedy
            can't answer questions about its content.
          </p>
        </div>
      </div>
    );
  }

  // status === 'indexed' — nothing visible; the thread renders.
  return null;
}
