'use client';

import React from 'react';

import Dialog from '@/components/Dialog';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
} from './DictionaryResultsView';

interface DictionarySheetProps {
  word: string;
  lang?: string;
  onDismiss: () => void;
  onManage?: () => void;
}

const DictionarySheet: React.FC<DictionarySheetProps> = ({ word, lang, onDismiss, onManage }) => {
  const state = useDictionaryResults({ word, lang });
  return (
    <Dialog
      isOpen
      snapHeight={0.75}
      dismissible
      header={
        <DictionaryResultsHeader
          headerClassName='-mt-4'
          currentWord={state.currentWord}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
        />
      }
      contentClassName='!px-0 !mt-0'
      onClose={onDismiss}
    >
      <DictionaryResultsBody {...state} />
    </Dialog>
  );
};

export default DictionarySheet;
