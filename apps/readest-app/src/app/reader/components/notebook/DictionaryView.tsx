import React, { useEffect } from 'react';
import { LuBookA } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDictionaryDockStore } from '@/store/dictionaryDockStore';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
  type UseDictionaryResultsArgs,
} from '../annotator/DictionaryResultsView';

const DockedLookup: React.FC<{ lookup: UseDictionaryResultsArgs; onManage: () => void }> = ({
  lookup,
  onManage,
}) => {
  const state = useDictionaryResults(lookup);
  return (
    <>
      <DictionaryResultsHeader
        headerClassName='shrink-0 pt-2'
        currentWord={state.currentWord}
        canGoBack={state.canGoBack}
        goBack={state.goBack}
        onManage={onManage}
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
const DictionaryView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const lookup = useDictionaryDockStore((s) => s.lookup);
  const setDocked = useDictionaryDockStore((s) => s.setDocked);
  const { setSettingsDialogBookKey, setActiveSettingsItemId, setSettingsDialogOpen } =
    useSettingsStore();

  useEffect(() => {
    setDocked(true);
    return () => setDocked(false);
  }, [setDocked]);

  const handleManage = () => {
    setSettingsDialogBookKey(bookKey);
    setActiveSettingsItemId('settings.language.dictionaries.manage');
    setSettingsDialogOpen(true);
  };

  return (
    // The Notebook is `select-none`; definitions are for copying. `text-base`
    // sizes them as in the popup.
    <div className='flex min-h-0 flex-1 select-text flex-col text-base'>
      {lookup ? (
        <DockedLookup key={lookup.id} lookup={lookup} onManage={handleManage} />
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
