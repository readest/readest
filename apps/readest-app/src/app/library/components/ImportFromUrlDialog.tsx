'use client';

import React, { useEffect, useState } from 'react';
import { MdLink } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';

interface ImportFromUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (url: string) => Promise<void>;
}

/**
 * Modal for the Library import-menu's "From URL" entry. Collects an article
 * URL, hands it to the page-clip pipeline, and closes. Tauri-only entry point
 * — a web build can't fetch cross-origin pages so this dialog never mounts
 * there.
 */
const ImportFromUrlDialog: React.FC<ImportFromUrlDialogProps> = ({ isOpen, onClose, onSubmit }) => {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state every time the dialog reopens.
  useEffect(() => {
    if (!isOpen) return;
    setUrl('');
    setSubmitting(false);
    setError(null);
  }, [isOpen]);

  const submit = async () => {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      setError(_('Enter a URL starting with http:// or https://'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(target);
      onClose();
    } catch (e) {
      // Tauri's `invoke` rejects with the raw Err string from Rust (not
      // wrapped in Error), and our pipeline also throws Error objects —
      // surface either shape directly so the user sees the real cause.
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : _('Could not fetch this page');
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('Import from Web URL')}
      // Size to content: `sm:!h-auto` overrides the Dialog default of
      // `sm:h-[65%]` so we don't end up with a near-full-height modal
      // for a one-line form. Width-constrained to a comfortable
      // reading measure.
      boxClassName='sm:!w-[480px] sm:!max-w-[480px] sm:!h-auto sm:!max-h-[80vh]'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/60 text-sm leading-relaxed'>
          {_('Paste an article link. Readest clips the page and saves it to your library.')}
        </p>
        <input
          type='url'
          autoFocus
          // Explicit placeholder colour — daisyUI's `input-bordered`
          // leaves placeholders too dark on light themes; the user
          // can mistake the example for actual content.
          className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
          placeholder='https://example.com/article'
          value={url}
          disabled={submitting}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {error && <p className='text-error text-sm leading-relaxed'>{error}</p>}
        <div className='flex justify-end gap-2 pt-1'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={onClose}
            disabled={submitting}
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            onClick={() => void submit()}
            disabled={submitting || !url.trim()}
          >
            {submitting ? (
              <span className='loading loading-spinner loading-xs' />
            ) : (
              <MdLink className='h-4 w-4' />
            )}
            {_('Import')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default ImportFromUrlDialog;
