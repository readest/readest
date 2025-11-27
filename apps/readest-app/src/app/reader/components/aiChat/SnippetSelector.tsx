import clsx from 'clsx';
import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

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
  return (
    <div className='snippet-selector border-b-base-300 bg-base-200 border-b p-4'>
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
