'use client';

import React from 'react';

import Popup from '@/components/Popup';
import type { ContextTranslationSettings } from '@/services/ai/contextTranslationTypes';
import { Position } from '@/utils/sel';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';
import { ContextTranslationPanel } from './ContextTranslationPanel';

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
  mode?: 'dictionary' | 'contextTranslate';
  contextTranslationSettings?: ContextTranslationSettings;
  onOpenAISettings?: () => void;
}

const DictionaryPopupContent = ({
  word,
  lang,
  onManage,
}: {
  word: string;
  lang?: string;
  onManage?: () => void;
}) => {
  const state = useDictionaryResults({ word, lang });
  return (
    <>
      <DictionaryResultsHeader
        headerClassName='-mt-2'
        currentWord={state.currentWord}
        canGoBack={state.canGoBack}
        goBack={state.goBack}
        onManage={onManage}
        onSpeak={state.speakWord}
        speaking={state.isSpeaking}
      />
      <div className='min-h-0 flex-1'>
        <DictionaryResultsBody {...state} />
      </div>
    </>
  );
};

const ContextTranslationPopupContent = ({
  word,
  lang,
  settings,
  onOpenSettings,
}: {
  word: string;
  lang?: string;
  settings: ContextTranslationSettings;
  onOpenSettings: () => void;
}) => (
  <>
    <DictionaryResultsHeader
      headerClassName='-mt-2'
      currentWord={word}
      canGoBack={false}
      goBack={() => {}}
      onManage={onOpenSettings}
    />
    <div className='min-h-0 flex-1 overflow-y-auto'>
      <ContextTranslationPanel
        selectedText={word}
        settings={settings}
        sourceLanguage={lang}
        onOpenSettings={onOpenSettings}
      />
    </div>
  </>
);

const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  word,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
  mode = 'dictionary',
  contextTranslationSettings,
  onOpenAISettings,
}) => (
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
      {mode === 'contextTranslate' && contextTranslationSettings ? (
        <ContextTranslationPopupContent
          word={word}
          lang={lang}
          settings={contextTranslationSettings}
          onOpenSettings={onOpenAISettings ?? (() => {})}
        />
      ) : (
        <DictionaryPopupContent word={word} lang={lang} onManage={onManage} />
      )}
    </div>
  </Popup>
);

export default DictionaryPopup;
