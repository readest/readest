'use client';

import React, { useState } from 'react';

import Dialog from '@/components/Dialog';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';
import WordLensGlossaryPopup from './WordLensGlossaryPopup';
import type { DictionarySelectionContext } from '@/services/dictionaries/types';

interface DictionarySheetProps {
  word: string;
  bookKey?: string;
  /** `book.metadata.series`, used as the series-scope identifier. */
  seriesName?: string;
  lang?: string;
  selection?: DictionarySelectionContext;
  onDismiss: () => void;
  onManage?: () => void;
}

const DictionarySheet: React.FC<DictionarySheetProps> = ({
  word,
  bookKey,
  seriesName,
  lang,
  selection,
  onDismiss,
  onManage,
}) => {
  const [draftTerm, setDraftTerm] = useState<string | null>(null);
  const state = useDictionaryResults({ word, lang, selection });
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
          currentWord={draftTerm ?? state.currentWord}
          canGoBack={state.canGoBack && !draftTerm}
          goBack={state.goBack}
          onManage={draftTerm ? undefined : onManage}
          onAddToWordLens={
            bookKey && !draftTerm ? () => setDraftTerm(state.currentWord) : undefined
          }
          onSpeak={draftTerm ? undefined : state.speakWord}
          speaking={state.isSpeaking}
        />
      }
      contentClassName='px-0! mt-0!'
      onClose={onDismiss}
    >
      {draftTerm && bookKey ? (
        <WordLensGlossaryPopup
          bookKey={bookKey}
          term={draftTerm}
          seriesName={seriesName}
          onCancel={() => setDraftTerm(null)}
          onSaved={() => setDraftTerm(null)}
        />
      ) : (
        <DictionaryResultsBody {...state} />
      )}
    </Dialog>
  );
};

export default DictionarySheet;
