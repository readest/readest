import clsx from 'clsx';
import React from 'react';
import {
  MdOutlineCloudDownload,
  MdOutlineCloudUpload,
  MdOutlineDelete,
  MdOutlineEdit,
  MdSaveAlt,
  MdExpandMore,
  MdExpandLess,
} from 'react-icons/md';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  formatAuthors,
  formatDate,
  formatBytes,
  formatLanguage,
  formatPublisher,
  formatTitle,
} from '@/utils/book';
import { saveSysSettings } from '@/helpers/settings';
import BookCover from '@/components/BookCover';
import Dropdown from '../Dropdown';
import MenuItem from '../MenuItem';

interface BookDetailViewProps {
  book: Book;
  metadata: BookMetadata | null;
  fileSize: number | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onDeleteCloudBackup?: () => void;
  onDeleteLocalCopy?: () => void;
  onDownload?: () => void;
  onUpload?: () => void;
  onExport?: () => void;
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
  onExport,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();

  const toggleSeriesCollapse = () => {
    saveSysSettings(envConfig, 'metadataSeriesCollapsed', !settings.metadataSeriesCollapsed);
  };

  const toggleOthersCollapse = () => {
    saveSysSettings(envConfig, 'metadataOthersCollapsed', !settings.metadataOthersCollapsed);
  };

  const toggleDescriptionCollapse = () => {
    saveSysSettings(
      envConfig,
      'metadataDescriptionCollapsed',
      !settings.metadataDescriptionCollapsed,
    );
  };

  return (
    <div className='relative w-full rounded-lg'>
      <div className='mb-6 me-4 flex h-32 items-start'>
        <div className='me-6 aspect-[28/41] h-32 shadow-lg sm:me-10'>
          <BookCover mode='list' book={book} />
        </div>
        <div className='title-author flex h-32 flex-col justify-between'>
          <div>
            <p className='text-base-content mb-2 line-clamp-2 break-words text-lg font-bold'>
              {formatTitle(book.title).replace(/\u00A0/g, ' ') || _('Untitled')}
            </p>
            <p className='text-neutral-content line-clamp-1'>
              {formatAuthors(book.author, book.primaryLanguage) || _('Unknown')}
            </p>
          </div>
          <div className='flex flex-nowrap items-center gap-3 sm:gap-x-4'>
            {onEdit && (
              <button
                onClick={onEdit}
                className={!metadata ? 'btn-disabled opacity-50' : ''}
                title={_('Edit Metadata')}
              >
                <MdOutlineEdit className='hover:fill-blue-500' />
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
              <button onClick={onDownload} title={_('Download from Cloud')}>
                <MdOutlineCloudDownload className='fill-base-content' />
              </button>
            )}
            {book.downloadedAt && onUpload && (
              <button onClick={onUpload} title={_('Upload to Cloud')}>
                <MdOutlineCloudUpload className='fill-base-content' />
              </button>
            )}
            {book.downloadedAt && onExport && (
              <button onClick={onExport} title={_('Export Book')}>
                <MdSaveAlt className='fill-base-content' />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className='text-base-content my-4'>
        <div className='metadata-others'>
          <button
            className={clsx(
              'flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
              settings.metadataOthersCollapsed ? 'hover:bg-base-200 rounded-lg' : '',
            )}
            onClick={toggleOthersCollapse}
          >
            <span className='text-neutral-content/85 text-base font-semibold'>{_('Metadata')}</span>
            <div className='transition-transform duration-200'>
              {settings.metadataOthersCollapsed ? (
                <MdExpandMore className='h-5 w-5' />
              ) : (
                <MdExpandLess className='h-5 w-5' />
              )}
            </div>
          </button>
          {!settings.metadataOthersCollapsed && (
            <div className='px-4 py-1'>
              <div className='grid grid-cols-2 gap-4 sm:grid-cols-3'>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Publisher')}</span>
                  <p className='text-neutral-content text-sm'>
                    {formatPublisher(metadata?.publisher || '') || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden pe-1 text-end sm:text-start'>
                  <span className='font-bold'>{_('Published')}</span>
                  <p className='text-neutral-content text-sm'>
                    {formatDate(metadata?.published, true) || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Updated')}</span>
                  <p className='text-neutral-content text-sm'>{formatDate(book.updatedAt) || ''}</p>
                </div>
                <div className='overflow-hidden pe-1 text-end sm:text-start'>
                  <span className='font-bold'>{_('Added')}</span>
                  <p className='text-neutral-content text-sm'>{formatDate(book.createdAt) || ''}</p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Language')}</span>
                  <p className='text-neutral-content text-sm'>
                    {formatLanguage(metadata?.language) || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden pe-1 text-end sm:text-start'>
                  <span className='font-bold'>{_('Subjects')}</span>
                  <p className='text-neutral-content line-clamp-3 text-sm'>
                    {formatAuthors(metadata?.subject || '') || _('Unknown')}
                  </p>
                </div>
                <div className='overflow-hidden'>
                  <span className='font-bold'>{_('Format')}</span>
                  <p className='text-neutral-content text-sm'>{book.format || _('Unknown')}</p>
                </div>
                <div className='overflow-hidden pe-1 text-end sm:text-start'>
                  <span className='font-bold'>{_('File Size')}</span>
                  <p className='text-neutral-content text-sm'>
                    {formatBytes(fileSize) || _('Unknown')}
                  </p>
                </div>
                <div className='col-span-2 overflow-hidden sm:col-span-1'>
                  <span className='font-bold'>{_('Identifier')}</span>
                  <p className='text-neutral-content line-clamp-1 text-sm'>
                    {metadata?.identifier || _('Unknown')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className='metadata-series'>
          <button
            className={clsx(
              'flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
              settings.metadataSeriesCollapsed ? 'hover:bg-base-200 rounded-lg' : '',
            )}
            onClick={toggleSeriesCollapse}
          >
            <span className='text-neutral-content/85 text-base font-semibold'>{_('Series')}</span>
            <div className='transition-transform duration-200'>
              {settings.metadataSeriesCollapsed ? (
                <MdExpandMore className='h-5 w-5' />
              ) : (
                <MdExpandLess className='h-5 w-5' />
              )}
            </div>
          </button>
          {!settings.metadataSeriesCollapsed && (
            <div className='px-4 py-1'>
              <div className='grid grid-cols-2 gap-4 sm:grid-cols-3'>
                <div className='overflow-hidden sm:col-span-2'>
                  <span className='font-bold'>{_('Series')}</span>
                  <p className='text-neutral-content text-sm'>{metadata?.series || _('Unknown')}</p>
                </div>
                <div className='overflow-hidden pe-1 text-end'>
                  <span className='font-bold'>{_('Series Index')}</span>
                  <p className='text-neutral-content text-sm'>
                    {metadata?.seriesIndex || _('Unknown')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className='metadata-description'>
          <button
            className={clsx(
              'flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition-colors',
              settings.metadataDescriptionCollapsed ? 'hover:bg-base-200' : '',
            )}
            onClick={toggleDescriptionCollapse}
          >
            <span className='text-neutral-content/85 text-base font-semibold'>
              {_('Description')}
            </span>
            <div className='transition-transform duration-200'>
              {settings.metadataDescriptionCollapsed ? (
                <MdExpandMore className='h-5 w-5' />
              ) : (
                <MdExpandLess className='h-5 w-5' />
              )}
            </div>
          </button>
          {!settings.metadataDescriptionCollapsed && (
            <div className='px-4 py-1'>
              <p
                className='text-neutral-content prose prose-sm max-w-full whitespace-pre-line text-sm'
                dangerouslySetInnerHTML={{
                  __html: metadata?.description || _('No description available'),
                }}
              ></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookDetailView;
