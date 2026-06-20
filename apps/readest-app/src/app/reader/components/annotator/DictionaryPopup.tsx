'use client';

import React from 'react';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';

interface DictionaryPopupProps {
  word: string;
  lang?: string;
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
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
}) => {
  const state = useDictionaryResults({ word, lang });
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
          currentWord={state.currentWord}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
        />
        <div className='min-h-0 flex-1'>
          <DictionaryResultsBody {...state} />
        </div>
      </div>
    </Popup>
  );
};

export default DictionaryPopup;
