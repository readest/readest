import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';

interface AnkiAudioPanelProps {
  onAnswer: (add: boolean) => void;
}

/**
 * Asks once before Sync gives an existing Readest Vocabulary note type its
 * audio fields (#7729): adding fields makes AnkiDroid's next AnkiWeb sync a
 * full one.
 */
const AnkiAudioPanel: React.FC<AnkiAudioPanelProps> = ({ onAnswer }) => {
  const _ = useTranslation();
  return (
    <section
      aria-label={_('Add Audio to Anki Cards')}
      className='mx-auto flex w-full max-w-md flex-col gap-3 p-4 text-start'
    >
      <h3 className='text-base font-medium'>{_('Add Audio to Anki Cards')}</h3>
      <p className='text-sm'>
        {_(
          "Each card can read its word aloud with your device's text-to-speech. Readest adds new fields to its note type and fills them on the cards it already added.",
        )}
      </p>
      <p className='not-eink:opacity-60 text-xs'>
        {_(
          "Sync AnkiDroid with AnkiWeb before you continue. After this change, AnkiDroid's next sync asks to upload or download the whole collection: choose Upload.",
        )}
      </p>
      <div className='flex justify-end gap-2'>
        <button type='button' className='btn btn-ghost btn-sm' onClick={() => onAnswer(false)}>
          {_('Not now')}
        </button>
        <button type='button' className='btn btn-contrast btn-sm' onClick={() => onAnswer(true)}>
          {_('Add Audio')}
        </button>
      </div>
    </section>
  );
};

export default AnkiAudioPanel;
