import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useTranslation } from '@/hooks/useTranslation';
import { TextSelection } from '@/utils/sel';
import { md5Fingerprint } from '@/utils/md5';
import { BookNote } from '@/types/book';
import useShortcuts from '@/hooks/useShortcuts';

interface NoteEditorProps {
  onSave: (selection: TextSelection, note: string) => void;
  onEdit: (annotation: BookNote) => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({ onSave, onEdit }) => {
  const _ = useTranslation();
  const {
    notebookNewAnnotation,
    notebookEditAnnotation,
    setNotebookNewAnnotation,
    setNotebookEditAnnotation,
    saveNotebookAnnotationDraft,
    getNotebookAnnotationDraft,
  } = useNotebookStore();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = React.useState('');

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
  }, [editorRef]);

  useEffect(() => {
    if (notebookEditAnnotation) {
      setNote(notebookEditAnnotation.note);
      if (editorRef.current) {
        editorRef.current.value = notebookEditAnnotation.note;
        editorRef.current.focus();
        adjustHeight();
      }
    } else if (notebookNewAnnotation) {
      const noteText = getAnnotationText();
      if (noteText) {
        const draftNote = getNotebookAnnotationDraft(md5Fingerprint(noteText)) || '';
        setNote(draftNote);
        if (editorRef.current) {
          editorRef.current.value = draftNote;
          editorRef.current.focus();
          adjustHeight();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookNewAnnotation, notebookEditAnnotation]);

  const adjustHeight = () => {
    if (editorRef.current) {
      editorRef.current.style.height = 'auto';
      editorRef.current.style.height = `${editorRef.current.scrollHeight}px`;
    }
  };

  const getAnnotationText = () => {
    return notebookEditAnnotation?.text || notebookNewAnnotation?.text || '';
  };

  const handleOnChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    adjustHeight();
    setNote(e.currentTarget.value);
  };

  const handleOnBlur = () => {
    if (editorRef.current && editorRef.current.value) {
      const noteText = getAnnotationText();
      if (noteText) {
        saveNotebookAnnotationDraft(md5Fingerprint(noteText), editorRef.current.value);
      }
    }
  };

  const handleSaveNote = () => {
    if (editorRef.current && notebookNewAnnotation) {
      onSave(notebookNewAnnotation, editorRef.current.value);
    } else if (editorRef.current && notebookEditAnnotation) {
      notebookEditAnnotation.note = editorRef.current.value;
      onEdit(notebookEditAnnotation);
    }
  };

  useShortcuts({
    onSaveNote: () => {
      if (editorRef.current && editorRef.current.value) {
        handleSaveNote();
      }
    },
    onCloseNote: () => {
      if (notebookNewAnnotation) {
        setNotebookNewAnnotation(null);
      }
      if (notebookEditAnnotation) {
        setNotebookEditAnnotation(null);
      }
    },
  });

  return (
    <div className='content note-editor-container bg-base-100 mt-2 rounded-md p-2'>
      <div className='flex w-full justify-between space-x-2'>
        <div className='relative w-full'>
          <textarea
            className={clsx(
              'note-editor textarea textarea-ghost min-h-[1em] resize-none !outline-none',
              'inset-0 w-full rounded-none border-0 bg-transparent p-0',
              'content font-size-sm',
            )}
            dir='auto'
            ref={editorRef}
            value={note}
            rows={1}
            spellCheck={false}
            onChange={handleOnChange}
            onBlur={handleOnBlur}
            placeholder={_('Add your notes here...')}
          ></textarea>
        </div>
      </div>
      <div className='flex items-start pt-2'>
        <div className='mr-2 min-h-full self-stretch border-l-2 border-gray-300'></div>
        <div className='content font-size-sm line-clamp-3 py-2'>
          <span className='content font-size-xs inline text-gray-500'>{getAnnotationText()}</span>
        </div>
      </div>
      <div className='flex justify-end p-2' dir='ltr'>
        <button
          className={clsx(
            'content btn btn-ghost font-size-sm hover:bg-transparent',
            'flex h-[1.3em] min-h-[1.3em] items-end p-0',
            editorRef.current && editorRef.current.value ? '' : 'btn-disabled !bg-opacity-0',
          )}
          onClick={handleSaveNote}
        >
          <div className='font-size-sm pr-1 align-bottom text-blue-500'>{_('Save')}</div>
        </button>
      </div>
    </div>
  );
};

export default NoteEditor;
