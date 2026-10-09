import React, { useRef, useState } from 'react';

import Select from '@/components/Select';
import { useEnv } from '@/context/EnvContext';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useTranslation } from '@/hooks/useTranslation';
import { saveWordLensGlossaryEntry } from '@/services/wordlens/customGlossary';
import type { WordLensGlossaryScope } from '@/types/book';

export interface WordLensGlossaryDraft {
  definition: string;
  scope: WordLensGlossaryScope;
}

interface WordLensGlossaryPopupProps {
  bookKey: string;
  term: string;
  /** `book.metadata.series`. Series scope is unavailable when this is empty. */
  seriesName?: string;
  /** Called with the draft before it is stored. Return false to keep the editor open. */
  onSave?: (draft: WordLensGlossaryDraft) => boolean | void;
  onCancel: () => void;
  onSaved?: () => void;
}

const WordLensGlossaryPopup: React.FC<WordLensGlossaryPopupProps> = ({
  bookKey,
  term,
  seriesName,
  onSave,
  onCancel,
  onSaved,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [definition, setDefinition] = useState('');
  const [scope, setScope] = useState<WordLensGlossaryScope>('global');
  const [saveError, setSaveError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useAutoFocus<HTMLInputElement>({ ref: inputRef });

  const series = seriesName?.trim() || '';
  const scopeOptions = [
    { value: 'global', label: _('Global') },
    { value: 'book', label: _('This book') },
    { value: 'series', label: _('This series'), disabled: !series },
  ];

  const handleSave = () => {
    const trimmed = definition.trim();
    if (!trimmed || !term.trim()) return;
    if (scope === 'series' && !series) return;
    const draft = { definition: trimmed, scope };
    if (onSave?.(draft) === false) return;
    void saveWordLensGlossaryEntry(envConfig, bookKey, { term, ...draft })
      .then((saved) => {
        if (saved) onSaved?.();
        else setSaveError(_('Could not save the entry.'));
      })
      .catch(() => {
        setSaveError(_('Could not save the entry.'));
      });
  };

  return (
    <div className='flex h-full flex-col gap-3 overflow-y-auto p-4'>
      <div className='flex items-center gap-2 text-xs text-base-content/70'>
        <span className='shrink-0 font-medium'>{_('Term')}</span>
        <span className='line-clamp-2 min-w-0 flex-1 break-words font-bold text-primary'>
          {term}
        </span>
      </div>
      <label className='flex flex-col gap-1 text-xs font-medium text-base-content/80'>
        {_('Definition')}
        <input
          ref={inputRef}
          type='text'
          value={definition}
          onChange={(event) => {
            setDefinition(event.target.value);
            setSaveError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSave();
          }}
          placeholder={_('Enter a definition')}
          aria-label={_('Definition')}
          className='bg-base-200 text-base-content placeholder:text-base-content/40 border-base-300 focus:border-primary focus:ring-primary eink-bordered w-full rounded-md border p-2 text-sm font-normal transition-all focus:outline-hidden focus:ring-1'
        />
      </label>
      <label className='flex items-center justify-between gap-2'>
        <span className='text-xs font-medium text-base-content/80'>{_('Scope')}</span>
        <Select
          className='max-w-[70%]'
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as WordLensGlossaryScope);
            setSaveError('');
          }}
          options={scopeOptions}
        />
      </label>
      {saveError && (
        <p className='text-error text-xs' role='alert'>
          {saveError}
        </p>
      )}
      <div className='mt-auto flex justify-end gap-2'>
        <button type='button' onClick={onCancel} className='btn btn-ghost btn-sm'>
          {_('Cancel')}
        </button>
        <button type='button' onClick={handleSave} className='btn btn-contrast btn-sm'>
          {_('Save')}
        </button>
      </div>
    </div>
  );
};

export default WordLensGlossaryPopup;
