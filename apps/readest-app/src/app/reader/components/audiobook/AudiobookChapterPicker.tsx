'use client';

import { useMemo, useState } from 'react';
import { MdCheck, MdClose, MdPlayArrow, MdStop } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import type { AudiobookChapter } from '@/types/book';

export const formatAudiobookTimecode = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

interface AudiobookChapterPickerProps {
  chapters: AudiobookChapter[];
  value: string;
  previewingId: string | null;
  onSelect: (chapterId: string) => void;
  onPreview: (chapter: AudiobookChapter) => void;
  onClose: () => void;
}

const AudiobookChapterPicker = ({
  chapters,
  value,
  previewingId,
  onSelect,
  onPreview,
  onClose,
}: AudiobookChapterPickerProps) => {
  const _ = useTranslation();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return chapters;
    return chapters.filter((chapter) => chapter.label.toLocaleLowerCase().includes(normalized));
  }, [chapters, query]);

  return (
    <div className='eink-bordered border-base-300 bg-base-100 mt-3 overflow-hidden rounded-lg border'>
      <div className='border-base-200 flex items-center gap-2 border-b p-2'>
        <input
          type='search'
          className='input input-sm eink-bordered min-w-0 flex-1'
          aria-label={_('Search audio chapters')}
          placeholder={_('Search audio chapters')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <button
          type='button'
          className='btn btn-ghost btn-sm btn-square'
          aria-label={_('Close audio chapter picker')}
          onClick={onClose}
        >
          <MdClose className='h-5 w-5' />
        </button>
      </div>
      <div
        className='divide-base-200 max-h-64 overflow-y-auto divide-y'
        role='listbox'
        aria-label={_('Audio chapters')}
      >
        <button
          type='button'
          role='option'
          aria-selected={!value}
          className='hover:bg-base-200 flex min-h-11 w-full items-center gap-3 px-3 py-2 text-start'
          onClick={() => onSelect('')}
        >
          <span className='min-w-0 flex-1'>{_('No audio')}</span>
          {!value && <MdCheck className='h-5 w-5 flex-shrink-0' />}
        </button>
        {filtered.map((chapter) => {
          const selected = chapter.id === value;
          const previewing = chapter.id === previewingId;
          return (
            <div key={chapter.id} className='flex min-h-12 items-center gap-1 pe-2'>
              <button
                type='button'
                role='option'
                aria-selected={selected}
                className='hover:bg-base-200 flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-start'
                onClick={() => onSelect(chapter.id)}
              >
                <span className='min-w-0 flex-1 truncate'>
                  {chapter.label} · {formatAudiobookTimecode(chapter.end - chapter.start)}
                </span>
                {selected && <MdCheck className='h-5 w-5 flex-shrink-0' />}
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-sm btn-square flex-shrink-0'
                aria-label={
                  previewing
                    ? _('Stop previewing {{chapter}}', { chapter: chapter.label })
                    : _('Preview {{chapter}}', { chapter: chapter.label })
                }
                onClick={() => onPreview(chapter)}
              >
                {previewing ? <MdStop className='h-5 w-5' /> : <MdPlayArrow className='h-5 w-5' />}
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className='text-neutral-content px-3 py-5 text-center text-sm'>
            {_('No matching audio chapters')}
          </p>
        )}
      </div>
    </div>
  );
};

export default AudiobookChapterPicker;
