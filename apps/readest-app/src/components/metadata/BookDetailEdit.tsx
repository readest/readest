import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdEdit, MdLock, MdLockOpen, MdOutlineSearch } from 'react-icons/md';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { flattenContributors, formatAuthors, formatPublisher, formatTitle } from '@/utils/book';
import { FormField } from './FormField';
import { IMAGE_ACCEPT_FORMATS, SUPPORTED_IMAGE_EXTS } from '@/services/constants';
import { isTauriAppPlatform } from '@/services/environment';
import BookCover from '@/components/BookCover';

interface BookDetailEditProps {
  book: Book;
  metadata: BookMetadata;
  fieldSources: Record<string, string>;
  lockedFields: Record<string, boolean>;
  fieldErrors: Record<string, string>;
  searchLoading: boolean;
  onFieldChange: (field: string, value: string) => void;
  onToggleFieldLock: (field: string) => void;
  onAutoRetrieve: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onCancel: () => void;
  onReset: () => void;
  onSave: () => void;
}

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

  const hasLockedFields = Object.values(lockedFields).some((locked) => locked);
  const allFieldsLocked = Object.values(lockedFields).every((locked) => locked);
  const isCoverLocked = lockedFields['coverImageUrl'] || false;
  const [newCoverImageUrl, setNewCoverImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (metadata.coverImageUrl) {
      setNewCoverImageUrl(metadata.coverImageUrl);
    }
  }, [metadata.coverImageUrl]);

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

  const selectImageFileWeb = () => {
    return new Promise((resolve) => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = IMAGE_ACCEPT_FORMATS;
      fileInput.multiple = false;
      fileInput.click();

      fileInput.onchange = () => {
        resolve(fileInput.files);
      };
    });
  };

  const selectImageFileTauri = async () => {
    const exts = appService?.isMobileApp ? [] : SUPPORTED_IMAGE_EXTS;
    const files = (await appService?.selectFiles(_('Select Cover Image'), exts)) || [];
    if (appService?.isIOSApp) {
      return files.filter((file) => {
        const fileExt = file.split('.').pop()?.toLowerCase() || 'unknown';
        return SUPPORTED_IMAGE_EXTS.includes(fileExt);
      });
    }
    return files;
  };

  const handleSelectLocalImage = async () => {
    let files;
    if (isTauriAppPlatform()) {
      files = (await selectImageFileTauri()) as string[];
      if (appService && files.length > 0) {
        metadata.coverImageFile = files[0]!;
        const tempName = `cover-${Date.now()}.png`;
        const cachePrefix = await appService.fs.getPrefix('Cache');
        await appService.fs.copyFile(files[0]!, tempName, 'Cache');
        metadata.coverImageUrl = await appService.fs.getURL(`${cachePrefix}/${tempName}`);
        setNewCoverImageUrl(metadata.coverImageUrl!);
      }
    } else {
      files = (await selectImageFileWeb()) as File[];
      if (files.length > 0) {
        metadata.coverImageBlobUrl = URL.createObjectURL(files[0]!);
        setNewCoverImageUrl(metadata.coverImageBlobUrl!);
      }
    }
  };

  return (
    <div className='bg-base-100 relative w-full rounded-lg'>
      <div className='mb-6 flex items-start gap-4'>
        <div className='flex w-[30%] max-w-32 flex-col gap-2'>
          <div
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
          </div>
          <div className='flex w-full gap-1'>
            <button
              onClick={handleSelectLocalImage}
              disabled={isCoverLocked}
              className={clsx(
                'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1',
                'border border-gray-300 bg-white hover:bg-gray-50',
                'disabled:cursor-not-allowed disabled:opacity-50',
                'text-sm sm:text-xs',
                isCoverLocked ? '!text-base-content !bg-base-200' : '!text-gray-500',
              )}
              title={_('Change cover image')}
            >
              <MdEdit
                className={clsx(
                  'h-5 w-5 sm:h-4 sm:w-4',
                  isCoverLocked ? 'fill-base-content' : 'fill-gray-600',
                )}
              />
              <span className='hidden sm:inline'>{_('Replace')}</span>
            </button>

            <button
              onClick={() => onToggleFieldLock('coverImageUrl')}
              className={clsx(
                'flex items-center justify-center rounded px-2 py-1 text-xs',
                'border border-gray-300 hover:bg-gray-50',
                isCoverLocked
                  ? 'bg-green-100 text-green-500 hover:bg-green-200'
                  : 'bg-white text-gray-500',
              )}
              title={isCoverLocked ? _('Unlock cover') : _('Lock cover')}
            >
              {isCoverLocked ? <MdLock className='h-3 w-3' /> : <MdLockOpen className='h-3 w-3' />}
            </button>
          </div>
        </div>
        <div className='flex-1 space-y-4'>
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
              <MdOutlineSearch className='h-4 w-4' />
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
                'disabled:cursor-not-allowed disabled:opacity-50',
                'text-yellow-500 hover:text-yellow-600',
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
                'disabled:cursor-not-allowed disabled:opacity-50',
                'text-green-500 hover:text-green-600',
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
