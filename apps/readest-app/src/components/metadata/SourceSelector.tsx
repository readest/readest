import React, { useEffect, useRef } from 'react';
import { MdOutlineCheck, MdOutlineEdit } from 'react-icons/md';

import { BookMetadata } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAuthors, formatTitle, getPrimaryLanguage } from '@/utils/book';
import BookCover from '../BookCover';
import { Metadata } from '@/services/metadata/types';
import { Book } from '@/types/book';

export interface MetadataSource {
  sourceName: string;
  sourceLabel: string;
  confidence: number;
  data: BookMetadata;
}

interface SourceSelectorProps {
  sources: MetadataSource[];
  isOpen: boolean;
  onSelect: (source: MetadataSource) => void;
  onClose: () => void;
}

const SourceSelector: React.FC<SourceSelectorProps> = ({ sources, isOpen, onSelect, onClose }) => {
  const _ = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus();
    }
  }, [isOpen]);

  const getConfidenceIcon = (confidence: number) => {
    if (confidence >= 90) return <MdOutlineCheck className='text-green-500' />;
    if (confidence >= 70) return <span className='text-yellow-500'>⚠</span>;
    return <span className='text-red-500'>❓</span>;
  };

  if (!isOpen) return null;

  return (
    <div className='source-selector fixed inset-0 z-[60] flex items-center justify-center bg-black/50'>
      <div
        ref={modalRef}
        tabIndex={-1}
        role='dialog'
        aria-modal='true'
        className='bg-base-100 mx-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg p-6'
      >
        <h3 className='mb-4 text-lg font-semibold'>{_('Select Metadata Source')}</h3>

        <div className='space-y-3'>
          {sources.map((source, index) => (
            <button
              tabIndex={0}
              key={index}
              onClick={() => onSelect(source)}
              className='hover:bg-base-300/75 bg-base-200 border-base-200 w-full cursor-pointer rounded-md border p-3 transition-colors'
            >
              <div className='flex items-start gap-4'>
                <div className='aspect-[28/41] h-full w-[40%] max-w-32 shadow-md'>
                  <BookCover
                    mode='list'
                    book={
                      {
                        title: formatTitle(source.data.title),
                        author: formatAuthors(source.data.author),
                        coverImageUrl: (source.data as Metadata)['coverImageUrl'] || '_blank',
                      } as Book
                    }
                  />
                </div>
                <div className='flex-1'>
                  <div className='mb-2 flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium capitalize'>{source.sourceLabel}</span>
                      {getConfidenceIcon(source.confidence)}
                    </div>
                    <span className='text-sm text-gray-500'>{source.confidence}%</span>
                  </div>

                  <div className='space-y-1 text-sm'>
                    <div className='font-medium'>{formatTitle(source.data.title)}</div>
                    <div className='text-gray-600'>{formatAuthors(source.data.author)}</div>
                    <div className='text-gray-500'>
                      {source.data.language ? `${getPrimaryLanguage(source.data.language)} • ` : ''}
                      {source.data.publisher ? `${source.data.publisher} • ` : ''}
                      {source.data.published}
                    </div>
                    {source.data.identifier && (
                      <div className='text-gray-500'>Identifier: {source.data.identifier}</div>
                    )}
                    {source.data.description && (
                      <div className='line-clamp-3 text-xs text-gray-500'>
                        {source.data.description}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}

          <button
            tabIndex={0}
            onClick={onClose}
            className='hover:bg-base-300/75 border-base-200 bg-base-200 cursor-pointer rounded-md border p-3 transition-colors'
          >
            <div className='flex items-center gap-2'>
              <MdOutlineEdit className='h-4 w-4' />
              <span className='font-medium'>{_('Keep manual input')}</span>
            </div>
          </button>
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <button onClick={onClose} className='hover:bg-base-200 rounded-md px-4 py-2'>
            {_('Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SourceSelector;
