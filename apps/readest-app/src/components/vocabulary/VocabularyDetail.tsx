import React, { useEffect, useRef, useState } from 'react';
import { MdArrowBack } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { getEnabledProviders } from '@/services/dictionaries/registry';
import { canAskAIForHint, hintFromAI, hintFromDictionary } from '@/services/vocabulary/hintSources';
import { VocabularyChips } from '@/app/reader/components/annotator/DictionaryResultsView';
import DictionarySheet from '@/app/reader/components/annotator/DictionarySheet';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import { navigateToReader } from '@/utils/nav';
import { getLocale } from '@/utils/misc';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The sentence with every case-insensitive match of the word in bold. */
const Highlighted: React.FC<{ sentence: string; word: string }> = ({ sentence, word }) => {
  if (!word.trim()) return <>{sentence}</>;
  const parts = sentence.split(new RegExp(`(${escapeRegExp(word)})`, 'giu'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <b key={i}>{part}</b> : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
};

const HintEditor: React.FC<{ entry: VocabularyEntry; onDone: () => void }> = ({
  entry,
  onDone,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [value, setValue] = useState(entry.hint ?? '');
  const [busy, setBusy] = useState<'dictionary' | 'ai' | null>(null);
  const [aiAllowed, setAiAllowed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void canAskAIForHint().then((ok) => alive && setAiAllowed(ok));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const fill = async (source: 'dictionary' | 'ai') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(source);
    try {
      let hint = '';
      if (source === 'dictionary') {
        const { settings, dictionaries } = useCustomDictionaryStore.getState();
        const providers = getEnabledProviders({
          settings,
          dictionaries,
          fs: appService ?? undefined,
        });
        hint = await hintFromDictionary(entry.word, entry.lang, providers, controller.signal);
      } else {
        const viewSettings = useSettingsStore.getState().settings.globalViewSettings;
        const target = viewSettings?.wordLensHintLang || getLocale();
        hint = await hintFromAI(
          entry.word,
          entry.occurrences[0],
          entry.lang,
          target,
          controller.signal,
        );
      }
      if (!controller.signal.aborted && hint) setValue(hint);
    } catch (err) {
      console.warn('[vocabulary] hint lookup failed', err);
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  const save = () => {
    useVocabularyStore.getState().setHint(entry.id, value);
    onDone();
  };

  return (
    <div className='flex flex-col gap-2'>
      <input
        aria-label={_('Hint')}
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        // Capture phase: Dialog stops every keydown at its own node.
        onKeyDownCapture={(e) => {
          // keyCode 229: WebKit's Enter that confirms an IME composition.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) save();
        }}
        placeholder={_('Short hint shown above the word')}
        className='eink-bordered input input-sm border-base-content/20 w-full'
      />
      <div className='flex flex-wrap gap-2'>
        <button
          type='button'
          className='btn btn-ghost btn-xs eink-bordered'
          disabled={!!busy}
          onClick={() => void fill('dictionary')}
        >
          {busy === 'dictionary' ? _('Looking up…') : _('From Dictionary')}
        </button>
        {aiAllowed && (
          <button
            type='button'
            className='btn btn-ghost btn-xs eink-bordered'
            disabled={!!busy}
            onClick={() => void fill('ai')}
          >
            {busy === 'ai' ? _('Asking…') : _('Ask AI')}
          </button>
        )}
        <div className='flex-1' />
        <button type='button' className='btn btn-ghost btn-xs' onClick={onDone}>
          {_('Cancel')}
        </button>
        <button type='button' className='btn btn-contrast btn-xs' onClick={save}>
          {_('Save')}
        </button>
      </div>
    </div>
  );
};

interface VocabularyDetailProps {
  entry: VocabularyEntry;
  onBack: () => void;
  onOpenBook?: () => void;
}

const VocabularyDetail: React.FC<VocabularyDetailProps> = ({ entry, onBack, onOpenBook }) => {
  const _ = useTranslation();
  const router = useRouter();
  const library = useLibraryStore((s) => s.library);
  const [editing, setEditing] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => setEditing(false), [entry.id]);

  const inLibrary = (hash?: string) =>
    !!hash && library.some((b) => b.hash === hash && !b.deletedAt);
  const openInBook = (hash: string, cfi: string) => {
    onOpenBook?.();
    navigateToReader(router, [hash], `cfi=${encodeURIComponent(cfi)}`);
  };

  return (
    <section aria-label={entry.word} className='flex min-h-0 flex-1 flex-col overflow-y-auto p-4'>
      <button
        type='button'
        aria-label={_('Back')}
        onClick={onBack}
        className='btn btn-ghost btn-sm btn-square mb-2 sm:hidden'
      >
        <MdArrowBack size={20} className='rtl:rotate-180' />
      </button>
      <h2 dir='auto' className='text-xl font-bold break-words'>
        {entry.word}
      </h2>

      <div className='mt-2'>
        {editing ? (
          <HintEditor entry={entry} onDone={() => setEditing(false)} />
        ) : (
          <div className='flex items-center gap-2'>
            <span className={clsx('text-sm', !entry.hint && 'not-eink:opacity-60')}>
              {entry.hint || _('No hint saved')}
            </span>
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered'
              onClick={() => setEditing(true)}
            >
              {_('Edit Hint')}
            </button>
          </div>
        )}
      </div>

      <div className='mt-3 flex justify-start'>
        <VocabularyChips word={entry.word} lang={entry.lang} />
      </div>

      <h3 className='not-eink:opacity-60 mt-4 mb-2 text-xs font-medium tracking-wide uppercase'>
        {_('Sentences')}
      </h3>
      {entry.occurrences.length === 0 ? (
        <p className='not-eink:opacity-60 text-sm'>{_('No sentences saved')}</p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {entry.occurrences.map((o) => (
            <li
              key={`${o.bookHash}|${o.cfi}|${o.at}`}
              className='eink-bordered bg-base-200/50 rounded-lg p-3 text-sm'
            >
              <p dir='auto'>
                <Highlighted sentence={o.sentence} word={entry.word} />
              </p>
              <div className='mt-1 flex items-center gap-2 text-xs'>
                <span className='not-eink:opacity-60 min-w-0 flex-1 truncate'>
                  {[o.bookTitle, new Date(o.at).toLocaleDateString(getLocale())]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {o.cfi && o.bookHash && inLibrary(o.bookHash) && (
                  <button
                    type='button'
                    className='btn btn-ghost btn-xs'
                    onClick={() => openInBook(o.bookHash!, o.cfi!)}
                  >
                    {_('Open in book')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className='mt-4 flex gap-2'>
        <button
          type='button'
          className='btn btn-ghost btn-sm eink-bordered'
          onClick={() => setLookingUp(true)}
        >
          {_('Look up')}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm eink-bordered'
          onClick={() => {
            useVocabularyStore.getState().remove(entry.id);
            onBack();
          }}
        >
          {_('Delete')}
        </button>
      </div>

      {lookingUp && (
        <DictionarySheet
          word={entry.word}
          lang={entry.lang === 'und' ? undefined : entry.lang}
          capture={{ lang: entry.lang }}
          onDismiss={() => setLookingUp(false)}
        />
      )}
    </section>
  );
};

export default VocabularyDetail;
