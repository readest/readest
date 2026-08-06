'use client';

import React from 'react';

import Dialog from '@/components/Dialog';
import type { ContextTranslationContext } from '@/services/ai/contextTranslationContext';
import type { ContextTranslationSettings } from '@/services/ai/contextTranslationTypes';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';
import { ContextTranslationPanel } from './ContextTranslationPanel';

interface DictionarySheetProps {
  word: string;
  lang?: string;
  onDismiss: () => void;
  onManage?: () => void;
  mode?: 'dictionary' | 'contextTranslate';
  contextTranslationSettings?: ContextTranslationSettings;
  contextTranslationContext?: ContextTranslationContext;
  onOpenAISettings?: () => void;
}

const DictionarySheet: React.FC<DictionarySheetProps> = ({
  word,
  lang,
  onDismiss,
  onManage,
  mode = 'dictionary',
  contextTranslationSettings,
  contextTranslationContext,
  onOpenAISettings,
}) => {
  const state = useDictionaryResults({ word, lang });
  const showContextTranslation = mode === 'contextTranslate' && !!contextTranslationSettings;
  const openSettings = onOpenAISettings ?? (() => {});

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
          currentWord={showContextTranslation ? word : state.currentWord}
          canGoBack={showContextTranslation ? false : state.canGoBack}
          goBack={showContextTranslation ? () => {} : state.goBack}
          onManage={showContextTranslation ? openSettings : onManage}
          onSpeak={showContextTranslation ? undefined : state.speakWord}
          speaking={showContextTranslation ? false : state.isSpeaking}
        />
      }
      contentClassName='!px-0 !mt-0'
      onClose={onDismiss}
    >
      {showContextTranslation ? (
        <ContextTranslationPanel
          selectedText={word}
          settings={contextTranslationSettings}
          sourceLanguage={lang}
          beforeContext={contextTranslationContext?.beforeContext}
          afterContext={contextTranslationContext?.afterContext}
          sentence={contextTranslationContext?.sentence}
          paragraph={contextTranslationContext?.paragraph}
          onOpenSettings={openSettings}
        />
      ) : (
        <DictionaryResultsBody {...state} />
      )}
    </Dialog>
  );
};

export default DictionarySheet;
