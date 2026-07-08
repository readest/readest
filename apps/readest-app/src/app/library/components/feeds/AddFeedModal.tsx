'use client';

import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useFeedStore } from '@/store/feedStore';
import { eventDispatcher } from '@/utils/event';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AddFeedModal: React.FC<AddFeedModalProps> = ({ isOpen, onClose }) => {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await useFeedStore.getState().addFeed(target);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Feed added successfully'),
        timeout: 2500,
      });
      onClose();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : _('Could not add this feed');
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('Add Feed')}
      boxClassName='sm:!w-[480px] sm:!max-w-[480px] sm:!h-auto sm:!max-h-[80vh]'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/60 text-sm leading-relaxed'>
          {_('Paste an RSS, Atom, or JSON Feed URL to subscribe.')}
        </p>
        <input
          type='url'
          autoFocus
          className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
          placeholder='https://example.com/feed.xml'
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
            className='btn btn-primary btn-sm'
            onClick={() => void submit()}
            disabled={submitting || !url.trim()}
          >
            {submitting && <span className='loading loading-spinner loading-xs' />}
            {_('Subscribe')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default AddFeedModal;
