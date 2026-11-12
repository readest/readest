import React, { useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { AnkiDeck } from '@/services/vocabulary/ankiDroid';

interface AnkiImportPanelProps {
  decks: AnkiDeck[];
  languages: { code: string; label: string }[];
  deckId: number;
  lang: string;
  onImport: (deckId: number, lang: string) => Promise<void>;
  onCancel: () => void;
}

/** Pick an AnkiDroid deck and the language its words belong to (#789). */
const AnkiImportPanel: React.FC<AnkiImportPanelProps> = ({
  decks,
  languages,
  deckId,
  lang,
  onImport,
  onCancel,
}) => {
  const _ = useTranslation();
  const [deck, setDeck] = useState(deckId);
  const [language, setLanguage] = useState(lang);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onImport(deck, language);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={_('Import from Anki')}
      className='mx-auto flex w-full max-w-md flex-col gap-4 p-4'
    >
      <label className='flex flex-col gap-1.5 text-sm'>
        <span className='font-medium'>{_('Deck')}</span>
        <select
          aria-label={_('Deck')}
          value={deck}
          onChange={(e) => setDeck(Number(e.target.value))}
          className='select select-sm eink-bordered w-full'
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className='flex flex-col gap-1.5 text-sm'>
        <span className='font-medium'>{_('Language')}</span>
        <select
          aria-label={_('Language')}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className='select select-sm eink-bordered w-full'
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <p className='not-eink:opacity-60 text-xs'>
        {_('New words come in as Learning. Words Anki counts as mature come in as Mastered.')}
      </p>
      <div className='flex justify-end gap-2'>
        <button type='button' className='btn btn-ghost btn-sm' onClick={onCancel}>
          {_('Cancel')}
        </button>
        <button
          type='button'
          className='btn btn-contrast btn-sm'
          disabled={busy}
          onClick={() => void submit()}
        >
          {_('Import')}
        </button>
      </div>
    </section>
  );
};

export default AnkiImportPanel;
