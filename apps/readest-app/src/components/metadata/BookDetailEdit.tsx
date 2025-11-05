import clsx from 'clsx';
import React, { useState } from 'react';
import { MdEdit, MdDelete, MdLock, MdLockOpen, MdOutlineSearch } from 'react-icons/md';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { flattenContributors, formatAuthors, formatPublisher, formatTitle } from '@/utils/book';
import { useFileSelector } from '@/hooks/useFileSelector';
import { FormField } from './FormField';
import BookCover from '@/components/BookCover';

interface BookDetailEditProps {
  book: Book;
  metadata: BookMetadata;
  fieldSources: Record<string, string>;
  lockedFields: Record<string, boolean>;
  fieldErrors: Record<string, string>;
  searchLoading: boolean;
  onFieldChange: (field: string, value: string | undefined) => void;
  onToggleFieldLock: (field: string) => void;
  onAutoRetrieve: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onCancel: () => void;
  onReset: () => void;
  onSave: () => void;
}

const emptyCoverImageUrl = '_blank';

const BookDetailEdit: React.FC<BookDetailEditProps> = ({
  book,
  metadata,
  fieldSources,
  lockedFields,
  fieldErrors,
  searchLoading,
  onFieldChange,
  onToggleFieldLock,
  onAutoRetrieve,
  onLockAll,
  onUnlockAll,
  onCancel,
  onReset,
  onSave,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { selectFiles } = useFileSelector(appService, _);

  const hasLockedFields = Object.values(lockedFields).some((locked) => locked);
  const allFieldsLocked = Object.values(lockedFields).every((locked) => locked);
  const isCoverLocked = lockedFields['coverImageUrl'] || false;
  const coverImageUrl = metadata.coverImageUrl || null;
  const [newCoverImageUrl, setNewCoverImageUrl] = useState<string | null>(coverImageUrl);

  const titleAuthorFields = [
    {
      field: 'title',
      label: _('Title'),
      required: true,
      value: formatTitle(metadata.title),
      placeholder: _('Enter book title'),
    },
    {
      field: 'subtitle',
      label: _('Subtitle'),
      required: false,
      value: formatTitle(metadata.subtitle || ''),
      placeholder: _('Enter book subtitle'),
    },
    {
      field: 'author',
      label: _('Author'),
      required: true,
      value: formatAuthors(metadata.author),
      placeholder: _('Enter author name'),
    },
  ];

  const metadataGridFields = [
    {
      field: 'series',
      label: _('Series'),
      value: metadata.series || '',
      placeholder: _('Enter series name'),
    },
    {
      field: 'seriesIndex',
      label: _('Series Index'),
      isNumber: true,
      value: String(metadata.seriesIndex || ''),
      placeholder: _('Enter series index'),
    },
    {
      field: 'seriesTotal',
      label: _('Total in Series'),
      isNumber: true,
      value: String(metadata.seriesTotal || ''),
      placeholder: _('Enter total books in series'),
    },
    {
      field: 'publisher',
      label: _('Publisher'),
      value: formatPublisher(metadata.publisher || ''),
      placeholder: _('Enter publisher'),
    },
    {
      field: 'published',
      label: _('Publication Date'),
      value: metadata.published || '',
      placeholder: _('YYYY or YYYY-MM-DD'),
    },
    {
      field: 'language',
      label: _('Language'),
      value: Array.isArray(metadata.language)
        ? metadata.language.join(', ')
        : metadata.language || '',
      placeholder: 'en, zh, fr',
    },
    {
      field: 'identifier',
      label: _('Identifier'),
      value: metadata.identifier || '',
      placeholder: '978-0123456789',
    },
  ];
  const metadataFullwidthFields = [
    {
      field: 'subject',
      label: _('Subjects'),
      value: flattenContributors(metadata.subject || []),
      placeholder: _('Fiction, Science, History'),
    },
    {
      field: 'description',
      label: _('Description'),
      type: 'textarea',
      rows: 4,
      value: metadata.description || '',
      placeholder: _('Enter book description'),
    },
  ];

  const handleSelectLocalImage = async () => {
    selectFiles({ type: 'covers', multiple: false }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      const selectedFile = result.files[0]!;
      if (selectedFile.path && appService) {
        const filePath = selectedFile.path;
        const imageUrl = await appService.getCachedImageUrl(filePath);
        onFieldChange('coverImageFile', filePath);
        onFieldChange('coverImageUrl', imageUrl);
        setNewCoverImageUrl(imageUrl);
      } else if (selectedFile.file) {
        const coverImageBlobUrl = URL.createObjectURL(selectedFile.file);
        onFieldChange('coverImageBlobUrl', coverImageBlobUrl);
        setNewCoverImageUrl(coverImageBlobUrl);
      }
    });
  };

  return (
    <div className='bg-base-100 relative w-full rounded-lg'>
      <div className='mb-6 flex items-stretch gap-4'>
        <div className='cover-field flex w-[30%] max-w-32 flex-col gap-2'>
          <button
            className='aspect-[28/41] h-full shadow-md'
            onClick={!isCoverLocked ? handleSelectLocalImage : undefined}
          >
            <BookCover
              mode='list'
              book={{
                ...book,
                metadata: {
                  ...metadata,
                  coverImageUrl: newCoverImageUrl || metadata.coverImageUrl,
                },
                ...(newCoverImageUrl ? { coverImageUrl: newCoverImageUrl } : {}),
              }}
            />
          </button>
          <div className='flex w-full justify-between gap-1'>
            <button
              onClick={handleSelectLocalImage}
              disabled={isCoverLocked}
              className={clsx(
                'flex w-1/2 min-w-0 items-center justify-center gap-1 rounded p-1 sm:w-3/5',
                'text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xs',
                isCoverLocked ? '!text-base-content bg-base-200' : 'bg-gray-100 !text-gray-500',
              )}
              title={_('Change cover image')}
            >
              <MdEdit
                className={clsx(
                  'h-5 w-5 flex-shrink-0 sm:h-4 sm:w-4',
                  isCoverLocked ? 'fill-base-content' : 'fill-gray-600',
                )}
              />
              <span className='hidden truncate sm:inline'>{_('Replace')}</span>
            </button>

            <button
              onClick={() => {
                setNewCoverImageUrl(emptyCoverImageUrl);
                onFieldChange('coverImageUrl', emptyCoverImageUrl);
                onFieldChange('coverImageFile', undefined);
                onFieldChange('coverImageBlobUrl', undefined);
              }}
              disabled={isCoverLocked}
              className={clsx(
                'flex w-1/4 items-center justify-center rounded p-1 sm:w-1/5',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'text-red-500 hover:bg-red-50 hover:text-red-600',
                isCoverLocked ? '!text-base-content bg-base-200' : 'bg-gray-100',
              )}
              title={_('Remove cover image')}
            >
              <MdDelete className='h-5 w-5 sm:h-4 sm:w-4' />
            </button>

            <button
              onClick={() => onToggleFieldLock('coverImageUrl')}
              className={clsx(
                'flex w-1/4 items-center justify-center rounded p-1 hover:bg-gray-50 sm:w-1/5',
                isCoverLocked
                  ? 'bg-green-100 text-green-500 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-500',
              )}
              title={isCoverLocked ? _('Unlock cover') : _('Lock cover')}
            >
              {isCoverLocked ? (
                <MdLock className='h-5 w-5 sm:h-4 sm:w-4' />
              ) : (
                <MdLockOpen className='h-5 w-5 sm:h-4 sm:w-4' />
              )}
            </button>
          </div>
        </div>
        <div className='title-fields flex flex-1 flex-col justify-between'>
          {titleAuthorFields.map(({ field, label, required, value, placeholder }) => (
            <FormField
              key={field}
              field={field}
              label={label}
              required={required}
              value={value}
              onFieldChange={onFieldChange}
              fieldSources={fieldSources}
              lockedFields={lockedFields}
              fieldErrors={fieldErrors}
              onToggleFieldLock={onToggleFieldLock}
              placeholder={placeholder}
            />
          ))}
        </div>
      </div>

      {/* Metadata Fields Grid */}
      <div className='mb-6 space-y-4'>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          {metadataGridFields.map(({ field, label, value, isNumber, placeholder }) => (
            <FormField
              key={field}
              field={field}
              label={label}
              value={value}
              isNumber={isNumber}
              onFieldChange={onFieldChange}
              fieldSources={fieldSources}
              lockedFields={lockedFields}
              fieldErrors={fieldErrors}
              onToggleFieldLock={onToggleFieldLock}
              placeholder={placeholder}
            />
          ))}
        </div>

        {metadataFullwidthFields.map(
          ({ field, label, type = 'input', rows, value, placeholder }) => (
            <FormField
              key={field}
              field={field}
              label={label}
              type={type as 'input' | 'textarea'}
              rows={rows}
              value={value}
              onFieldChange={onFieldChange}
              fieldSources={fieldSources}
              lockedFields={lockedFields}
              fieldErrors={fieldErrors}
              onToggleFieldLock={onToggleFieldLock}
              placeholder={placeholder}
            />
          ),
        )}
      </div>

      {/* Action Buttons */}
      <div className='flex flex-col items-center justify-between gap-4'>
        <div className='flex w-full items-center gap-2'>
          <button
            onClick={onAutoRetrieve}
            disabled={searchLoading}
            className='flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50'
            title={_('Auto-Retrieve Metadata')}
          >
            {searchLoading ? (
              <span className='loading loading-spinner h-4 w-4'></span>
            ) : (
              <MdOutlineSearch className='mt-[1px] h-4 w-4' />
            )}
            <span className='sm:hidden'>{_('Auto')}</span>
            <span className='hidden sm:inline'>{_('Auto-Retrieve')}</span>
          </button>

          {/* Lock/Unlock All Buttons */}
          <div className='flex items-center gap-1 border-l border-gray-300 pl-2'>
            <button
              onClick={onUnlockAll}
              disabled={!hasLockedFields}
              className={clsx(
                'hover:bg-base-200 flex items-center gap-1 rounded px-2 py-1 text-sm',
                'disabled:cursor-not-allowed disabled:opacity-80',
                'text-yellow-600 hover:text-yellow-700',
              )}
              title={_('Unlock all fields')}
            >
              <MdLockOpen className='h-3 w-3' />
              {_('Unlock All')}
            </button>
            <button
              onClick={onLockAll}
              disabled={allFieldsLocked}
              className={clsx(
                'hover:bg-base-200 flex items-center gap-1 rounded px-2 py-1 text-sm',
                'disabled:cursor-not-allowed disabled:opacity-80',
                'text-green-600 hover:text-green-700',
              )}
              title={_('Lock all fields')}
            >
              <MdLock className='h-3 w-3' />
              {_('Lock All')}
            </button>
          </div>
        </div>

        <div className='flex w-full justify-end gap-4'>
          <button
            onClick={onCancel}
            className='hover:bg-base-200 rounded-md border-neutral-300 px-4 py-2'
          >
            {_('Cancel')}
          </button>
          <button
            onClick={onReset}
            className='hover:bg-base-200 rounded-md border-neutral-300 px-4 py-2'
          >
            {_('Reset')}
          </button>
          <button
            onClick={onSave}
            disabled={fieldErrors && Object.keys(fieldErrors).length > 0}
            className='rounded-md bg-green-500 px-4 py-2 text-white hover:bg-green-600 disabled:opacity-50'
          >
            {_('Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookDetailEdit;
