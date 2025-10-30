import clsx from 'clsx';
import React from 'react';
import {
  MdOutlineCloudDownload,
  MdOutlineCloudUpload,
  MdOutlineDelete,
  MdOutlineEdit,
} from 'react-icons/md';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import {
  formatAuthors,
  formatDate,
  formatBytes,
  formatLanguage,
  formatPublisher,
  formatTitle,
} from '@/utils/book';
import BookCover from '@/components/BookCover';
import Dropdown from '../Dropdown';
import MenuItem from '../MenuItem';

interface BookDetailViewProps {
  book: Book;
  metadata: BookMetadata;
  fileSize: number | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onDeleteCloudBackup?: () => void;
  onDeleteLocalCopy?: () => void;
  onDownload?: () => void;
  onUpload?: () => void;
}

const BookDetailView: React.FC<BookDetailViewProps> = ({
  book,
  metadata,
  fileSize,
  onEdit,
  onDelete,
  onDeleteCloudBackup,
  onDeleteLocalCopy,
  onDownload,
  onUpload,
}) => {
  const _ = useTranslation();

  return (
    <div className='relative w-full rounded-lg'>
      <div className='mb-6 me-4 flex h-32 items-start'>
        <div className='me-10 aspect-[28/41] h-32 shadow-lg'>
          <BookCover mode='list' book={book} />
        </div>
        <div className='title-author flex h-32 flex-col justify-between'>
          <div>
            <p className='text-base-content mb-2 line-clamp-2 text-lg font-bold'>
              {formatTitle(book.title) || _('Untitled')}
            </p>
            <p className='text-neutral-content line-clamp-1'>
              {formatAuthors(book.author, book.primaryLanguage) || _('Unknown')}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-x-4'>
            {onEdit && (
              <button onClick={onEdit} title={_('Edit Metadata')}>
                <MdOutlineEdit className='fill-base-content hover:fill-blue-500' />
              </button>
            )}
            {onDelete && (
              <Dropdown
                label={_('Delete Book Options')}
                className='dropdown-bottom flex justify-center'
                buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0'
                toggleButton={<MdOutlineDelete className='fill-red-500' />}
              >
                <div
                  className={clsx(
                    'delete-menu dropdown-content dropdown-center no-triangle',
                    'border-base-300 !bg-base-200 z-20 mt-1 max-w-[90vw] shadow-2xl',
                  )}
                >
                  <MenuItem
                    noIcon
                    transient
                    label={_('Remove from Cloud & Device')}
                    onClick={onDelete}
                  />
                  <MenuItem
                    noIcon
                    transient
                    label={_('Remove from Cloud Only')}
                    onClick={onDeleteCloudBackup}
                    disabled={!book.uploadedAt}
                  />
                  <MenuItem
                    noIcon
                    transient
                    label={_('Remove from Device Only')}
                    onClick={onDeleteLocalCopy}
                    disabled={!book.downloadedAt}
                  />
                </div>
              </Dropdown>
            )}
            {book.uploadedAt && onDownload && (
              <button onClick={onDownload}>
                <MdOutlineCloudDownload className='fill-base-content' />
              </button>
            )}
            {book.downloadedAt && onUpload && (
              <button onClick={onUpload}>
                <MdOutlineCloudUpload className='fill-base-content' />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className='text-base-content my-4'>
        <div className='mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3'>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Publisher')}</span>
            <p className='text-neutral-content text-sm'>
              {formatPublisher(metadata.publisher || '') || _('Unknown')}
            </p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Published')}</span>
            <p className='text-neutral-content text-sm'>
              {formatDate(metadata.published, true) || _('Unknown')}
            </p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Updated')}</span>
            <p className='text-neutral-content text-sm'>{formatDate(book.updatedAt) || ''}</p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Added')}</span>
            <p className='text-neutral-content text-sm'>{formatDate(book.createdAt) || ''}</p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Language')}</span>
            <p className='text-neutral-content text-sm'>
              {formatLanguage(metadata.language) || _('Unknown')}
            </p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Subjects')}</span>
            <p className='text-neutral-content line-clamp-3 text-sm'>
              {formatAuthors(metadata.subject || '') || _('Unknown')}
            </p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('Format')}</span>
            <p className='text-neutral-content text-sm'>{book.format || _('Unknown')}</p>
          </div>
          <div className='overflow-hidden'>
            <span className='font-bold'>{_('File Size')}</span>
            <p className='text-neutral-content text-sm'>{formatBytes(fileSize) || _('Unknown')}</p>
          </div>
        </div>
        <div>
          <span className='font-bold'>{_('Description')}</span>
          <p
            className='text-neutral-content prose prose-sm max-w-full text-sm'
            dangerouslySetInnerHTML={{
              __html: metadata.description || _('No description available'),
            }}
          ></p>
        </div>
      </div>
    </div>
  );
};

export default BookDetailView;
