'use client';

import { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { readTextFromClipboard } from '@/utils/clipboard';

interface ImportPastedTextDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<boolean>;
}

const ImportPastedTextDialog: React.FC<ImportPastedTextDialogProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const _ = useTranslation();
  const defaultTitle = _('Pasted Text');
  const [title, setTitle] = useState(defaultTitle);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(defaultTitle);
    setContent('');
    setBusy(false);
    setError(null);
  }, [isOpen, defaultTitle]);

  const pasteFromClipboard = async () => {
    const text = await readTextFromClipboard();
    if (text === null) {
      setError(_('Could not read the clipboard. Paste into the text box instead.'));
      return;
    }
    setContent(text);
    setError(null);
  };

  const importText = async () => {
    if (busy || !title.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const filename = title
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/[. ]+$/g, '')
        .slice(0, 120);
      if (!filename) {
        setError(_('Enter a book title.'));
        return;
      }
      const imported = await onImport(
        new File([content], `${filename}.txt`, { type: 'text/plain' }),
      );
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
      onClose={onClose}
      title={_('Import Pasted Text')}
      aboveKeyboard
      boxClassName='sm:w-[520px]! sm:max-w-[520px]! sm:h-auto! sm:max-h-[80vh]!'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <label className='flex flex-col gap-1.5'>
          <span className='text-base-content/70 text-xs'>{_('Book title')}</span>
          <input
            type='text'
            className='input eink-bordered w-full'
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className='flex flex-col gap-1.5'>
          <span className='text-base-content/70 text-xs'>{_('Text')}</span>
          <textarea
            className='textarea eink-bordered h-48 w-full select-text'
            value={content}
            disabled={busy}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={() => void pasteFromClipboard()}
            disabled={busy}
          >
            {_('Paste from Clipboard')}
          </button>
          <div className='flex gap-2'>
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
              disabled={busy || !title.trim() || !content.trim()}
            >
              {_('Import')}
            </button>
          </div>
        </div>
        {error && (
          <p className='text-error text-sm' role='alert'>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
};

export default ImportPastedTextDialog;
