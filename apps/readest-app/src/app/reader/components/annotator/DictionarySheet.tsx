'use client';

import React from 'react';

import Dialog from '@/components/Dialog';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
  lookupToPin,
  type UseDictionaryResultsArgs,
  type VocabularyCapture,
} from './DictionaryResultsView';
import type { DictionarySelectionContext } from '@/services/dictionaries/types';

interface DictionarySheetProps {
  word: string;
  lang?: string;
  selection?: DictionarySelectionContext;
  /** Save this lookup to the vocabulary builder and show the Learning / Mastered chips. */
  capture?: VocabularyCapture;
  /** Ask the AI context dictionary alone (the Context Dictionary tool, #7497). */
  contextOnly?: boolean;
  onDismiss: () => void;
  onManage?: () => void;
  /** Move the lookup into the Notebook's Dictionary tab; omit to hide the pin. */
  onPin?: (lookup: UseDictionaryResultsArgs) => void;
}

const DictionarySheet: React.FC<DictionarySheetProps> = ({
  word,
  lang,
  selection,
  capture,
  contextOnly,
  onDismiss,
  onManage,
  onPin,
}) => {
  const state = useDictionaryResults({ word, lang, selection, capture, contextOnly });
  const handlePin = () =>
    onPin?.(lookupToPin({ word, lang, selection, capture, contextOnly }, state));
  return (
    <Dialog
      isOpen
      snapHeight={0.75}
      dismissible
      header={
        <DictionaryResultsHeader
          // The -mt-4 compensates for Dialog's drag handle, which is `sm:hidden`
          // (shown only below sm). Mirror that breakpoint so on sm+ (no handle)
          // the header isn't pulled up into the top edge.
          headerClassName='-mt-4 sm:mt-0'
          currentWord={state.currentWord}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
          onPin={onPin && handlePin}
          onSpeak={state.speakWord}
          speaking={state.isSpeaking}
          vocabularyLang={state.vocabularyLang}
          manualVocabularyOccurrence={state.manualVocabularyOccurrence}
        />
      }
      // The sheet renders inside the `select-none` reader page; let its
      // definitions be selected and copied, as in DictionaryPopup (#7731).
      contentClassName='px-0! mt-0! select-text'
      onClose={onDismiss}
    >
      <DictionaryResultsBody {...state} />
    </Dialog>
  );
};

export default DictionarySheet;
