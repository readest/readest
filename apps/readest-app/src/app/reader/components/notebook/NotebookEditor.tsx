import React, { useRef } from 'react';
import { PiNotePencil } from 'react-icons/pi';
import TextEditor, { TextEditorRef } from '@/components/TextEditor';
import { useTranslation } from '@/hooks/useTranslation';
import { useNotebookDocumentStore } from '@/store/notebookDocumentStore';
import { flushNotebookDocument } from '../../hooks/useNotebookDocumentCoordinator';

interface NotebookEditorProps {
  bookKey: string;
  handleOpenAnnotations: () => void;
}

const NotebookEditor: React.FC<NotebookEditorProps> = ({ bookKey, handleOpenAnnotations }) => {
  const _ = useTranslation();
  const bookHash = bookKey.split('-')[0]!;
  const session = useNotebookDocumentStore((state) => state.sessions[bookHash]);
  const mutate = useNotebookDocumentStore((state) => state.mutate);
  const setSelection = useNotebookDocumentStore((state) => state.setSelection);
  const chooseRecovery = useNotebookDocumentStore((state) => state.chooseRecovery);
  const editorRef = useRef<TextEditorRef>(null);
  const composingRef = useRef(false);

  if (!session) return null;

  const applyContent = (value: string) => {
    const result = mutate(bookHash, value);
    if (!result.accepted) editorRef.current?.setValue(session.content);
  };

  const status = (() => {
    if (session.status === 'saving') return _('Saving…');
    if (session.status === 'error') return _("Couldn't save");
    if (session.status === 'waiting-for-position') return _('Waiting for a valid book position');
    if (session.status === 'clean' && session.hasEdited) return _('Saved');
    return '';
  })();

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2 px-3 pb-2'>
      {session.status === 'recovery-choice' && (
        <div className='eink-bordered bg-base-100 rounded-lg border p-3 text-sm'>
          <p>{_('Unsaved Notebook changes conflict with the latest saved version.')}</p>
          <div className='mt-2 flex justify-end gap-2' dir='ltr'>
            <button
              type='button'
              className='eink-bordered btn btn-ghost h-8 min-h-8 px-3'
              onClick={() => chooseRecovery(bookHash, 'latest')}
            >
              {_('Use latest saved')}
            </button>
            <button
              type='button'
              className='btn btn-contrast h-8 min-h-8 px-3'
              onClick={() => chooseRecovery(bookHash, 'recover')}
            >
              {_('Recover draft')}
            </button>
          </div>
        </div>
      )}
      <div className='eink-bordered bg-base-100 min-h-0 flex-1 rounded-lg border p-3'>
        <TextEditor
          ref={editorRef}
          value={session.content}
          onChange={(value) => {
            if (!composingRef.current) applyContent(value);
          }}
          onSave={() => void flushNotebookDocument(bookKey)}
          onBlur={() => void flushNotebookDocument(bookKey)}
          onSelect={(start, end) => setSelection(bookHash, start, end)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(value) => {
            composingRef.current = false;
            applyContent(value);
          }}
          placeholder={_('Start writing about this book…')}
          ariaLabel={_('Notebook')}
          className='h-full min-h-0 select-text overflow-y-auto text-start'
          spellCheck
          autoResize={false}
        />
      </div>
      <div className='flex min-h-8 flex-wrap items-center gap-2 text-xs'>
        <button
          type='button'
          onClick={handleOpenAnnotations}
          className='eink-bordered btn btn-ghost h-8 min-h-8 gap-1 px-2 text-xs font-normal max-sm:h-11 max-sm:min-h-11'
        >
          <PiNotePencil size={16} />
          {_('All notes')}
        </button>
        <span className='text-error flex-1'>
          {session.error === 'size-limit'
            ? _('Notebook is too large to save. Copy or remove some text to continue.')
            : !session.recoveryAvailable && session.revision > session.savedRevision
              ? _('Notebook recovery is unavailable. Keep this book open until it saves.')
              : ''}
        </span>
        <span role='status' aria-live='polite' className='text-base-content/60 ms-auto shrink-0'>
          {status}
        </span>
      </div>
    </div>
  );
};

export default NotebookEditor;
