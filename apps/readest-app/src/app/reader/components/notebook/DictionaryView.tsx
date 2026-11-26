import React, { useEffect, useRef } from 'react';
import { LuBookA } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useDictionaryDockStore } from '@/store/dictionaryDockStore';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
  type UseDictionaryResultsArgs,
} from '../annotator/DictionaryResultsView';

const DockedLookup: React.FC<{ lookup: UseDictionaryResultsArgs & { id: number } }> = ({
  lookup,
}) => {
  const state = useDictionaryResults(lookup);
  // Closing the tab cancels an AI answer still on its way, and only finished
  // answers are cached, so the tab forgets the lookup rather than ask the AI
  // again when it comes back (#7971).
  const answering = useRef(false);
  answering.current = !!state.cards[BUILTIN_PROVIDER_IDS.context]?.pending;
  useEffect(
    () => () => {
      if (!answering.current) return;
      useDictionaryDockStore.setState((s) => (s.lookup?.id === lookup.id ? { lookup: null } : s));
    },
    [lookup.id],
  );
  return (
    <>
      <DictionaryResultsHeader
        headerClassName='shrink-0 pt-2'
        currentWord={state.currentWord}
        canGoBack={state.canGoBack}
        goBack={state.goBack}
        onSpeak={state.speakWord}
        speaking={state.isSpeaking}
        vocabularyLang={state.vocabularyLang}
        manualVocabularyOccurrence={state.manualVocabularyOccurrence}
      />
      <div className='min-h-0 flex-1'>
        <DictionaryResultsBody {...state} keepOpenOnTap />
      </div>
    </>
  );
};

/**
 * The Notebook's Dictionary tab (#7730): the latest lookup, kept beside the
 * book while the reader highlights, annotates or searches. While it is on
 * screen the reader sends new lookups here instead of opening a popup.
 */
const DictionaryView: React.FC = () => {
  const _ = useTranslation();
  const lookup = useDictionaryDockStore((s) => s.lookup);
  const setDocked = useDictionaryDockStore((s) => s.setDocked);

  useEffect(() => {
    setDocked(true);
    return () => setDocked(false);
  }, [setDocked]);

  return (
    // The Notebook is `select-none`; definitions are for copying. `text-base`
    // sizes them as in the popup.
    <div className='flex min-h-0 flex-1 select-text flex-col text-base'>
      {lookup ? (
        <DockedLookup key={lookup.id} lookup={lookup} />
      ) : (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center'>
          <LuBookA size={32} className='not-eink:opacity-50' />
          <p className='not-eink:opacity-70 text-sm'>
            {_('Look up a word to see its definitions here.')}
          </p>
        </div>
      )}
    </div>
  );
};

export default DictionaryView;
