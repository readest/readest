import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { useAIChatStore } from '@/store/aiChatStore';

interface SnippetSelectorProps {
  onSelectPage: () => void;
  onSelectChapter: () => void;
  isLoading?: boolean;
}

const SnippetSelector: React.FC<SnippetSelectorProps> = ({
  onSelectPage,
  onSelectChapter,
  isLoading = false,
}) => {
  const _ = useTranslation();
  const { activeSnippet } = useAIChatStore();

  if (activeSnippet) {
    return (
      <div className='snippet-preview border-b-base-300 border-b bg-base-200 p-4'>
        <div className='mb-2 text-xs font-semibold text-base-content/70'>
          {activeSnippet.type === 'highlight'
            ? _('Highlight')
            : activeSnippet.type === 'page'
              ? _('Current Page')
              : _('Current Chapter')}
        </div>
        <div className='text-sm text-base-content/90 line-clamp-3'>{activeSnippet.text}</div>
      </div>
    );
  }

  return (
    <div className='snippet-selector border-b-base-300 border-b bg-base-200 p-4'>
      <div className='mb-3 text-sm font-medium'>{_('Select content to discuss')}</div>
      <div className='flex flex-col gap-2'>
        <button
          className={clsx('btn btn-outline btn-sm', isLoading && 'btn-disabled')}
          onClick={onSelectPage}
          disabled={isLoading}
        >
          {_('Use Current Page')}
        </button>
        <button
          className={clsx('btn btn-outline btn-sm', isLoading && 'btn-disabled')}
          onClick={onSelectChapter}
          disabled={isLoading}
        >
          {_('Use Current Chapter')}
        </button>
      </div>
    </div>
  );
};

export default SnippetSelector;
