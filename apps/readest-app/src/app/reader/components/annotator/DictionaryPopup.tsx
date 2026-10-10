'use client';

import React, { useState } from 'react';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';
import WordLensGlossaryPopup from './WordLensGlossaryPopup';
import type { DictionarySelectionContext } from '@/services/dictionaries/types';

interface DictionaryPopupProps {
  word: string;
  bookKey?: string;
  /** `book.metadata.series`, used as the series-scope identifier. */
  seriesName?: string;
  lang?: string;
  selection?: DictionarySelectionContext;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
  /**
   * Invoked when the user clicks the header gear. The host (Annotator)
   * decides how to navigate — typically by opening the SettingsDialog and
   * deep-linking to the dictionaries sub-page.
   */
  onManage?: () => void;
}

const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  word,
  bookKey,
  seriesName,
  lang,
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
}) => {
  const [draftTerm, setDraftTerm] = useState<string | null>(null);
  const state = useDictionaryResults({ word, lang, selection });

  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      className='select-text'
      onDismiss={onDismiss}
    >
      {/* `overflow-hidden rounded-lg` clips the body's section backgrounds /
          borders to the Popup's rounded shape. */}
      <div className='flex h-full flex-col overflow-hidden rounded-lg pt-4'>
        <DictionaryResultsHeader
          headerClassName='-mt-2'
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
        <div className='min-h-0 flex-1'>
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
        </div>
      </div>
    </Popup>
  );
};

export default DictionaryPopup;
