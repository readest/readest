'use client';

import { useEffect, useRef, useState } from 'react';
import { MdContentPaste } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { readTextFromClipboard } from '@/utils/clipboard';
import { createTextBookFile, getTextTitle } from '@/utils/txt';

interface ImportPastedTextDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Hand the `.txt` file to the normal library import path; false keeps the draft. */
  onImport: (file: File) => Promise<boolean>;
}

/**
 * Modal for the Library import-menu's "From Pasted Text" entry (#6747). The
 * text becomes a `.txt` file and takes the local-file import path; a blank
 * title falls back to the text's first line.
 */
const ImportPastedTextDialog: React.FC<ImportPastedTextDialogProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const _ = useTranslation();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openingRef = useRef(0);

  // Reset transient state every time the dialog reopens.
  useEffect(() => {
    if (!isOpen) return;
    openingRef.current += 1;
    setTitle('');
    setContent('');
    setBusy(false);
    setError(null);
  }, [isOpen]);

  const pasteFromClipboard = async () => {
    const opening = openingRef.current;
    const draft = content;
    const text = await readTextFromClipboard();
    // The paste prompt can stay up while the user types or reopens the dialog.
    if (opening !== openingRef.current) return;
    if (text === null) {
      setError(_('Could not read the clipboard. Paste into the text box instead.'));
      return;
    }
    setContent((current) => (current === draft ? text : current));
    setError(null);
  };

  // Escape, the backdrop and swipe-to-dismiss must not drop a running import.
  const close = () => {
    if (!busy) onClose();
  };

  const importText = async () => {
    if (busy || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await onImport(createTextBookFile(content, title, _('Pasted Text')));
      if (!imported) {
        setError(_('Failed to import book.'));
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('Failed to import book.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={_('Import Pasted Text')}
      aboveKeyboard
      // Size to content — same override as ImportNovelDialog.
      boxClassName='sm:w-[520px]! sm:max-w-[520px]! sm:h-auto! sm:max-h-[80vh]!'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Paste an article or notes to read or listen to them like a book')}
        </p>
        <div className='flex flex-col gap-1.5'>
          <label className='text-base-content/70 text-xs' htmlFor='pasted-text-title'>
            {_('Book title')}
          </label>
          <input
            id='pasted-text-title'
            type='text'
            className='input eink-bordered placeholder:text-base-content/35 w-full'
            placeholder={getTextTitle(content) || _('Pasted Text')}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <label className='text-base-content/70 text-xs' htmlFor='pasted-text-content'>
              {_('Text')}
            </label>
            <button
              type='button'
              className='btn btn-ghost btn-xs touch-target gap-1.5'
              onClick={() => void pasteFromClipboard()}
              disabled={busy}
            >
              <MdContentPaste aria-hidden='true' className='h-3.5 w-3.5' />
              {_('Paste')}
            </button>
          </div>
          <textarea
            id='pasted-text-content'
            autoFocus
            className='textarea eink-bordered h-48 w-full select-text'
            value={content}
            disabled={busy}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        {error && (
          <p className='text-error text-sm leading-relaxed' role='alert'>
            {error}
          </p>
        )}
        <div className='flex justify-end gap-2 pt-1'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={onClose}
            disabled={busy}
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            onClick={() => void importText()}
            disabled={busy || !content.trim()}
          >
            {busy && <span className='loading loading-spinner loading-xs' />}
            {_('Import')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default ImportPastedTextDialog;
