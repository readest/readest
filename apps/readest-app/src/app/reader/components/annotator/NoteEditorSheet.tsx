'use client';

import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import Dialog from '@/components/Dialog';
import AnnotationNoteEditor from './AnnotationNoteEditor';

interface NoteEditorSheetProps {
  value: string;
  onSave: (note: string) => void;
  onCancel: () => void;
}

/**
 * Phone-sized presentation of the Annotate note editor: a bottom sheet, so the
 * editor sits above the on-screen keyboard instead of being anchored to a
 * selection the keyboard would cover. Mirrors DictionarySheet, which makes the
 * same call for the same reason.
 */
const NoteEditorSheet: React.FC<NoteEditorSheetProps> = ({ value, onSave, onCancel }) => {
  const _ = useTranslation();
  return (
    <Dialog
      isOpen
      title={_('Note')}
      // Just over half the screen: enough room for a few lines above the
      // keyboard, without burying the passage the note is about.
      snapHeight={0.6}
      dismissible
      contentClassName='px-0! mt-0! flex-1 min-h-0'
      onClose={onCancel}
    >
      <AnnotationNoteEditor className='h-full' value={value} onSave={onSave} onCancel={onCancel} />
    </Dialog>
  );
};

export default NoteEditorSheet;
