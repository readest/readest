'use client';

import { BookOpen } from 'lucide-react';
import type { ReedyMessagePart } from '../../store/reedyStore';

/**
 * Citation chip — clickable when an `onClick` handler is wired (the
 * notebook integration passes a handler that calls
 * `getView(bookKey)?.goTo(cfi)`). Static when no handler (e.g. preview
 * rendering in tests).
 */
export function CitationPart({
  part,
  onClick,
}: {
  part: Extract<ReedyMessagePart, { type: 'citation' }>;
  onClick?: (cfi: string) => void;
}) {
  const baseClass =
    'border-base-content/10 bg-base-200/60 my-1 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px]';
  const body = (
    <>
      <BookOpen className='text-base-content/60 mt-0.5 size-3 shrink-0' />
      <div className='flex min-w-0 flex-col gap-0.5 text-start'>
        <div className='text-base-content font-medium'>
          {part.chapterTitle ?? `Section ${part.sectionIndex + 1}`}
        </div>
        <div className='text-base-content/70 line-clamp-3'>{part.snippet}</div>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type='button'
        className={`${baseClass} hover:bg-base-200 transition-colors`}
        onClick={() => onClick(part.cfi)}
        title={part.cfi}
      >
        {body}
      </button>
    );
  }
  return <div className={baseClass}>{body}</div>;
}
