import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { initVocabularySync } from '@/services/vocabulary/vocabularySync';
import VocabularyView from './VocabularyView';

const DIALOG_ID = 'vocabulary_window';

export const setVocabularyDialogVisible = (visible: boolean) => {
  document
    .getElementById(DIALOG_ID)
    ?.dispatchEvent(new CustomEvent('setDialogVisibility', { detail: { visible } }));
};

/** The vocabulary builder window (#789): review looked-up words and export them. */
export const VocabularyDialog: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const el = document.getElementById(DIALOG_ID);
    const handle = (event: Event) =>
      setIsOpen((event as CustomEvent<{ visible: boolean }>).detail.visible);
    el?.addEventListener('setDialogVisibility', handle);
    return () => el?.removeEventListener('setDialogVisibility', handle);
  }, []);

  useEffect(() => {
    if (!isOpen || !appService) return;
    void useVocabularyStore
      .getState()
      .load(appService)
      .then(() => initVocabularySync());
  }, [isOpen, appService]);

  return (
    <Dialog
      id={DIALOG_ID}
      isOpen={isOpen}
      title={_('Vocabulary')}
      onClose={() => setIsOpen(false)}
      boxClassName='sm:h-[85%]! sm:w-[760px]! sm:max-w-[90vw]!'
      contentClassName='px-4! sm:px-6! flex flex-col min-h-0'
    >
      {isOpen && <VocabularyView onOpenBook={() => setIsOpen(false)} />}
    </Dialog>
  );
};

export default VocabularyDialog;
