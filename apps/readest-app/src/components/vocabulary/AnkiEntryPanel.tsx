import React, { useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { AnkiEntryPickerState } from './useAnkiLink';

interface AnkiEntryPanelProps extends AnkiEntryPickerState {
  onSave: (id: string) => Promise<void>;
  onCancel: () => void;
}

/** Pick the dictionary whose entry Sync puts on the back of Readest's Anki cards (#7728). */
const AnkiEntryPanel: React.FC<AnkiEntryPanelProps> = ({
  providers,
  selected,
  onSave,
  onCancel,
}) => {
  const _ = useTranslation();
  // A saved dictionary that is no longer enabled shows, and saves, as None.
  const [id, setId] = useState(providers.some((p) => p.id === selected) ? selected : '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={_('Dictionary for Anki Cards')}
      className='mx-auto flex w-full max-w-md flex-col gap-3 p-4 text-start'
    >
      <h3 className='text-base font-medium'>{_('Dictionary for Anki Cards')}</h3>
      <p className='text-sm'>
        {_(
          "Sync with Anki puts this dictionary's entry on the back of each card, for up to 30 cards per Sync",
        )}
      </p>
      <label className='flex flex-col gap-1.5 text-sm'>
        <span className='font-medium'>{_('Dictionary')}</span>
        <select
          aria-label={_('Dictionary')}
          value={id}
          onChange={(e) => setId(e.target.value)}
          className='select select-sm eink-bordered w-full'
        >
          <option value=''>{_('None')}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <div className='flex justify-end gap-2'>
        <button type='button' className='btn btn-ghost btn-sm' onClick={onCancel}>
          {_('Cancel')}
        </button>
        <button
          type='button'
          className='btn btn-contrast btn-sm'
          disabled={busy}
          onClick={() => void save()}
        >
          {_('Save')}
        </button>
      </div>
    </section>
  );
};

export default AnkiEntryPanel;
