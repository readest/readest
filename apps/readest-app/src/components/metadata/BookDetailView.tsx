import React from 'react';
import {
  MdOutlineDelete,
  MdOutlineCloudDownload,
  MdOutlineCloudUpload,
  MdOutlineCloudOff,
  MdOutlineEdit,
} from 'react-icons/md';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import {
  formatAuthors,
  formatDate,
  formatFileSize,
  formatLanguage,
  formatPublisher,
  formatTitle,
} from '@/utils/book';
import BookCover from '@/components/BookCover';

interface BookDetailViewProps {
  book: Book;
  metadata: BookMetadata;
  fileSize: number | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onDeleteCloudBackup?: () => void;
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
            <p className='text-base-content mb-2 line-clamp-2 break-all text-lg font-bold'>
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
              <button onClick={onDelete}>
                <MdOutlineDelete className='fill-red-500' />
              </button>
            )}
            {book.uploadedAt && onDeleteCloudBackup && (
              <button onClick={onDeleteCloudBackup}>
                <MdOutlineCloudOff className='fill-red-500' />
              </button>
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
            <p className='text-neutral-content text-sm'>
              {formatFileSize(fileSize) || _('Unknown')}
            </p>
          </div>
        </div>
        <div>
          <span className='font-bold'>{_('Description')}</span>
          <p
            className='text-neutral-content prose prose-sm text-sm'
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
