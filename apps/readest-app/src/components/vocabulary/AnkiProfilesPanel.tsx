import React, { useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type {
  AnkiFieldSource,
  AnkiProfile,
  AnkiProfileSettings,
} from '@/services/vocabulary/types';
import { uniqueId } from '@/utils/misc';
import type { AnkiProfilesState } from './useAnkiLink';

interface AnkiProfilesPanelProps extends AnkiProfilesState {
  /** The vocabulary's languages and books, which a profile can be used for. */
  languages: { value: string; label: string }[];
  books: { hash: string; title: string }[];
  onSave: (settings: AnkiProfileSettings) => Promise<void>;
  onCancel: () => void;
}

const selectClass = 'select select-sm eink-bordered w-full';
const inputClass = 'input input-sm eink-bordered w-full';

/** Drop the uses of profiles that no longer exist. */
const withoutMissing = (uses: Record<string, string>, ids: Set<string>) =>
  Object.fromEntries(Object.entries(uses).filter(([, id]) => ids.has(id)));

/**
 * Card profiles for Sync with Anki (#7849): the deck, note type, fields and
 * tags a language's or a book's words get, instead of Readest's own cards.
 */
const AnkiProfilesPanel: React.FC<AnkiProfilesPanelProps> = ({
  decks,
  noteTypes,
  settings,
  languages,
  books,
  onSave,
  onCancel,
}) => {
  const _ = useTranslation();
  const [draft, setDraft] = useState(settings);
  const [editing, setEditing] = useState<AnkiProfile | null>(null);
  // The tags as typed: splitting on every key would eat the space before the next one.
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);

  const sources: { value: AnkiFieldSource; label: string }[] = [
    { value: 'word', label: _('Word') },
    { value: 'sentence', label: _('Sentence') },
    { value: 'hint', label: _('Hint') },
    { value: 'book', label: _('Book Title') },
    { value: 'author', label: _('Author') },
    { value: 'language', label: _('Language') },
    { value: 'entry', label: _('Dictionary Entry') },
    { value: 'audio', label: _('Audio') },
    { value: 'link', label: _('Link to Book') },
  ];

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    const isNew = !draft.profiles.some((p) => p.id === editing.id);
    const type = noteTypes.find((t) => t.name === editing.noteType);
    // A profile synced from a device whose collection has a note type this one lacks.
    const fieldNames = editing.noteType ? (type?.fields ?? Object.keys(editing.fields)) : [];
    const hasWord = fieldNames.some((n) => editing.fields[n] === 'word');
    // Sync reads a note type's word, hint and entry from the same fields
    // whichever profile sent the note, so profiles of one note type agree on them.
    const readFrom = (p: AnkiProfile, source: AnkiFieldSource) =>
      fieldNames.find((n) => p.fields[n] === source);
    // A mapping to a field the note type no longer has reads nothing: it
    // mustn't keep another profile of the note type from being repaired.
    const stale = (p: AnkiProfile, source: AnkiFieldSource) =>
      !readFrom(p, source) && Object.values(p.fields).includes(source);
    const clash = editing.noteType
      ? draft.profiles.find(
          (p) =>
            p.id !== editing.id &&
            p.noteType === editing.noteType &&
            (['word', 'hint', 'entry'] as const).some(
              (s) => !stale(p, s) && readFrom(p, s) !== readFrom(editing, s),
            ),
        )
      : undefined;
    const ready = !!editing.name.trim() && (!editing.noteType || hasWord) && !clash;
    const change = (patch: Partial<AnkiProfile>) => setEditing({ ...editing, ...patch });
    const done = () => {
      const profile = {
        ...editing,
        name: editing.name.trim(),
        tags: tagText.split(/\s+/).filter(Boolean),
      };
      setDraft({
        ...draft,
        profiles: isNew
          ? [...draft.profiles, profile]
          : draft.profiles.map((p) => (p.id === profile.id ? profile : p)),
      });
      setEditing(null);
    };
    const remove = () => {
      const profiles = draft.profiles.filter((p) => p.id !== editing.id);
      const ids = new Set(profiles.map((p) => p.id));
      setDraft({
        profiles,
        languages: withoutMissing(draft.languages, ids),
        books: withoutMissing(draft.books, ids),
      });
      setEditing(null);
    };

    return (
      <section
        aria-label={_('Anki Card Profiles')}
        className='mx-auto flex w-full max-w-md flex-col gap-3 overflow-y-auto p-4 text-start'
      >
        <h3 className='text-base font-medium'>{isNew ? _('New Profile') : _('Edit Profile')}</h3>
        <label className='flex flex-col gap-1.5 text-sm'>
          <span className='font-medium'>{_('Name')}</span>
          <input
            type='text'
            aria-label={_('Name')}
            aria-required='true'
            value={editing.name}
            onChange={(e) => change({ name: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className='flex flex-col gap-1.5 text-sm'>
          <span className='font-medium'>{_('Deck')}</span>
          <select
            aria-label={_('Deck')}
            value={editing.deck}
            onChange={(e) => change({ deck: e.target.value })}
            className={selectClass}
          >
            <option value=''>{_('Readest Vocabulary, by Language')}</option>
            {[...new Set([...decks, editing.deck].filter(Boolean))].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className='flex flex-col gap-1.5 text-sm'>
          <span className='font-medium'>{_('Note Type')}</span>
          <select
            aria-label={_('Note Type')}
            value={editing.noteType}
            onChange={(e) => {
              const noteType = e.target.value;
              // Start from another profile's fields for this note type.
              const like = noteType && draft.profiles.find((p) => p.noteType === noteType);
              change({ noteType, fields: like ? { ...like.fields } : {} });
            }}
            className={selectClass}
          >
            <option value=''>{_('Readest Vocabulary')}</option>
            {[...new Set([...noteTypes.map((t) => t.name), editing.noteType].filter(Boolean))].map(
              (name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ),
            )}
          </select>
        </label>
        {fieldNames.length > 0 && (
          <fieldset className='flex flex-col gap-2 text-sm'>
            <legend className='mb-1.5 font-medium'>{_('Fields')}</legend>
            {fieldNames.map((name) => (
              <label key={name} className='flex items-center gap-3'>
                <span dir='auto' className='w-1/3 min-w-0 truncate'>
                  {name}
                </span>
                <select
                  aria-label={name}
                  value={editing.fields[name] ?? ''}
                  onChange={(e) => {
                    const fields = { ...editing.fields };
                    if (e.target.value) fields[name] = e.target.value as AnkiFieldSource;
                    else delete fields[name];
                    change({ fields });
                  }}
                  className='select select-sm eink-bordered min-w-0 flex-1'
                >
                  <option value=''>{_('Empty')}</option>
                  {sources.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {!hasWord && (
              <p className='not-eink:opacity-60 text-xs'>
                {_('Choose a field for the word: Sync finds cards by it')}
              </p>
            )}
            {clash && (
              <p className='not-eink:opacity-60 text-xs'>
                {_('Word, Hint and Dictionary Entry must use the same fields as in “{{name}}”', {
                  name: clash.name,
                })}
              </p>
            )}
            {Object.values(editing.fields).includes('link') && (
              <p className='not-eink:opacity-60 text-xs'>
                {_(
                  'To open Link to Book from a card, turn on “Allow cards to launch other apps” in AnkiDroid’s Advanced settings',
                )}
              </p>
            )}
          </fieldset>
        )}
        <label className='flex flex-col gap-1.5 text-sm'>
          <span className='font-medium'>{_('Tags')}</span>
          <input
            type='text'
            aria-label={_('Tags')}
            placeholder={_('Separate tags with spaces')}
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className='flex items-center justify-end gap-2'>
          {!isNew && (
            <button
              type='button'
              className='btn btn-ghost btn-sm text-error me-auto'
              onClick={remove}
            >
              {_('Delete')}
            </button>
          )}
          <button type='button' className='btn btn-ghost btn-sm' onClick={() => setEditing(null)}>
            {_('Cancel')}
          </button>
          <button
            type='button'
            // btn-contrast keeps its colors when disabled; dim it until the profile is complete.
            className='btn btn-contrast btn-sm disabled:opacity-40'
            disabled={!ready}
            onClick={done}
          >
            {_('Done')}
          </button>
        </div>
      </section>
    );
  }

  const edit = (profile: AnkiProfile) => {
    setEditing(profile);
    setTagText(profile.tags.join(' '));
  };

  const profileOptions = draft.profiles.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name}
    </option>
  ));
  const use = (key: 'languages' | 'books', target: string, id: string) => {
    const uses = { ...draft[key] };
    if (id) uses[target] = id;
    else delete uses[target];
    setDraft({ ...draft, [key]: uses });
  };

  return (
    <section
      aria-label={_('Anki Card Profiles')}
      className='mx-auto flex w-full max-w-md flex-col gap-3 overflow-y-auto p-4 text-start'
    >
      <h3 className='text-base font-medium'>{_('Anki Card Profiles')}</h3>
      <p className='text-sm'>
        {_('Choose the deck, note type and fields Sync with Anki uses for a language or a book')}
      </p>
      <ul className='flex flex-col gap-1'>
        {draft.profiles.map((p) => (
          <li key={p.id}>
            <button
              type='button'
              onClick={() => edit(p)}
              className='eink-bordered bg-base-200 not-eink:hover:bg-base-300/60 flex w-full flex-col items-start rounded-lg px-3 py-2 text-start'
            >
              <span dir='auto' className='text-sm font-medium'>
                {p.name}
              </span>
              <span dir='auto' className='not-eink:opacity-60 w-full truncate text-xs'>
                {[
                  p.deck || _('Readest Vocabulary, by Language'),
                  p.noteType || _('Readest Vocabulary'),
                ].join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type='button'
        className='btn btn-ghost btn-sm eink-bordered self-start'
        onClick={() =>
          edit({ id: uniqueId(), name: '', deck: '', noteType: '', fields: {}, tags: [] })
        }
      >
        {_('New Profile')}
      </button>
      {draft.profiles.length > 0 && (
        <>
          <fieldset className='flex flex-col gap-2 text-sm'>
            <legend className='mb-1.5 font-medium'>{_('Languages')}</legend>
            {languages.map((l) => (
              <label key={l.value} className='flex items-center gap-3'>
                <span className='w-1/3 min-w-0 truncate'>{l.label}</span>
                <select
                  aria-label={l.label}
                  value={draft.languages[l.value] ?? ''}
                  onChange={(e) => use('languages', l.value, e.target.value)}
                  className='select select-sm eink-bordered min-w-0 flex-1'
                >
                  <option value=''>{_('Readest Vocabulary')}</option>
                  {profileOptions}
                </select>
              </label>
            ))}
          </fieldset>
          {books.length > 0 && (
            <fieldset className='flex flex-col gap-2 text-sm'>
              <legend className='mb-1.5 font-medium'>{_('Books')}</legend>
              {books.map((b) => (
                <label key={b.hash} className='flex items-center gap-3'>
                  <span dir='auto' className='w-1/3 min-w-0 truncate'>
                    {b.title}
                  </span>
                  <select
                    aria-label={b.title}
                    value={draft.books[b.hash] ?? ''}
                    onChange={(e) => use('books', b.hash, e.target.value)}
                    className='select select-sm eink-bordered min-w-0 flex-1'
                  >
                    <option value=''>{_("Language's Profile")}</option>
                    {profileOptions}
                  </select>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
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

export default AnkiProfilesPanel;
