import clsx from 'clsx';
import React, { useState } from 'react';
import {
  MdOutlineCloudDownload,
  MdOutlineCloudUpload,
  MdOutlineDelete,
  MdOutlineEdit,
  MdSaveAlt,
  MdExpandMore,
  MdExpandLess,
  MdOutlineAudiotrack,
  MdAudiotrack,
  MdOutlineDescription,
  MdDescription,
} from 'react-icons/md';

import { Book } from '@/types/book';
import { AudiobookConfig } from '@/types/book';
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
  audiobookConfig?: AudiobookConfig;
  onAddAudiobook?: () => void;
  onReplaceAudiobook?: () => void;
  onRemoveAudiobook?: () => void;
  onAddTranscript?: () => void;
  onReplaceTranscript?: () => void;
  onRemoveTranscript?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDeleteCloudBackup?: () => void;
  onDeleteLocalCopy?: () => void;
  onDownload?: () => void;
  onUpload?: () => void;
  onExport?: () => void;
}

/* ── Shared Citadel style tokens ── */
const ACTION_ICON = 'w-5 h-5 fill-[#8d7450] transition-colors hover:fill-[#d4b57b]';

const dropdownPanelClass = clsx(
  'dropdown-content dropdown-center no-triangle z-20 mt-1 max-w-[90vw] rounded-xl',
  'border border-[rgba(201,162,39,0.22)]',
  'shadow-[0_16px_48px_rgba(0,0,0,0.48)]',
  'bg-[linear-gradient(180deg,rgba(28,20,16,0.96),rgba(18,13,10,0.98))]',
);

const dropdownItemClass = '!text-[#d6c6a8] hover:!bg-[rgba(20,16,12,0.28)]';

const sectionHeader = clsx(
  'flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-left transition-colors',
  'hover:bg-[rgba(20,16,12,0.22)]',
);

const sectionLabelClass = 'text-[#cfb07a]/90 text-[13px] font-semibold uppercase tracking-[0.14em]';

const fieldLabelClass = 'text-[#d6c6a8] text-[11px] font-semibold uppercase tracking-[0.09em]';

const fieldValueClass = 'text-[#a3937d] text-[13px] leading-snug';

const BookDetailView: React.FC<BookDetailViewProps> = ({
  book,
  metadata,
  fileSize,
  audiobookConfig,
  onAddAudiobook,
  onReplaceAudiobook,
  onRemoveAudiobook,
  onAddTranscript,
  onReplaceTranscript,
  onRemoveTranscript,
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
  const [showAudiobookPanel, setShowAudiobookPanel] = useState(false);

  const hasAudiobook = !!audiobookConfig;
  const hasTranscript = !!audiobookConfig?.transcriptPath;

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

  const handleAudiobookIconClick = () => {
    if (hasAudiobook) {
      setShowAudiobookPanel((prev) => !prev);
    } else {
      onAddAudiobook?.();
    }
  };

  return (
    <div className='w-full'>
      {/* ── Section 1: Book identity block ── */}
      <div className='flex items-start gap-5'>
        <div className='aspect-[28/41] h-[7.5rem] shrink-0 overflow-hidden rounded-lg shadow-[0_4px_20px_rgba(0,0,0,0.38)]'>
          <BookCover mode='list' book={book} />
        </div>
        <div className='min-w-0 flex-1 pt-0.5'>
          <h2 className='mb-1 line-clamp-2 font-serif text-lg font-semibold leading-snug text-[#d4b57b]'>
            {formatTitle(book.title).replace(/\u00A0/g, ' ') || _('Untitled')}
          </h2>
          <p className='mb-2.5 line-clamp-1 text-[12px] font-medium uppercase tracking-[0.10em] text-[#9f8254]'>
            {formatAuthors(book.author, book.primaryLanguage) || _('Unknown')}
          </p>
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
            <span className='inline-flex items-center gap-1.5 rounded-md border border-[rgba(185,133,44,0.14)] bg-[rgba(14,10,8,0.4)] px-2 py-0.5 text-[11px] text-[#968671]'>
              {book.format || _('Unknown')}
            </span>
            {fileSize != null && (
              <span className='inline-flex items-center gap-1.5 rounded-md border border-[rgba(185,133,44,0.14)] bg-[rgba(14,10,8,0.4)] px-2 py-0.5 text-[11px] text-[#968671]'>
                {formatBytes(fileSize) || _('Unknown')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 2: Action icon row ── */}
      <div className='my-4 flex items-center rounded-xl border border-[rgba(185,133,44,0.12)] bg-[rgba(14,10,8,0.30)] px-3 py-2'>
        <div className='flex w-full items-center justify-center gap-5'>
          {onEdit && (
            <button
              onClick={onEdit}
              disabled={!metadata}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(185,133,44,0.08)]',
                !metadata && 'opacity-30',
              )}
              title={_('Edit Metadata')}
            >
              <MdOutlineEdit className={ACTION_ICON} />
            </button>
          )}

          {/* Audiobook action */}
          <button
            onClick={handleAudiobookIconClick}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-all',
              showAudiobookPanel && 'bg-[rgba(185,133,44,0.10)]',
              'hover:bg-[rgba(185,133,44,0.08)]',
            )}
            title={hasAudiobook ? _('Audiobook Options') : _('Add Audiobook')}
          >
            {hasAudiobook ? (
              <MdAudiotrack className='h-5 w-5 fill-[#d4b57b]' />
            ) : (
              <MdOutlineAudiotrack className={ACTION_ICON} />
            )}
          </button>

          {/* Transcript action — only shown when audiobook is attached */}
          {hasAudiobook && (
            <button
              onClick={() => onAddTranscript?.()}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                'hover:bg-[rgba(185,133,44,0.08)]',
              )}
              title={hasTranscript ? _('Transcript Attached') : _('Add Transcript')}
            >
              {hasTranscript ? (
                <MdDescription className='h-5 w-5 fill-[#d4b57b]' />
              ) : (
                <MdOutlineDescription className={ACTION_ICON} />
              )}
            </button>
          )}

          {onDelete && (
            <Dropdown
              label={_('Delete Book Options')}
              className='dropdown-bottom flex justify-center'
              buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 rounded-lg hover:bg-[rgba(160,64,48,0.08)]'
              toggleButton={
                <MdOutlineDelete className='h-5 w-5 fill-[#a04030] transition-colors hover:fill-red-500' />
              }
            >
              <div className={dropdownPanelClass}>
                <MenuItem
                  noIcon
                  transient
                  label={_('Remove from Cloud & Device')}
                  onClick={onDelete}
                  buttonClass={dropdownItemClass}
                />
                <MenuItem
                  noIcon
                  transient
                  label={_('Remove from Cloud Only')}
                  onClick={onDeleteCloudBackup}
                  disabled={!book.uploadedAt}
                  buttonClass={dropdownItemClass}
                />
                <MenuItem
                  noIcon
                  transient
                  label={_('Remove from Device Only')}
                  onClick={onDeleteLocalCopy}
                  disabled={!book.downloadedAt}
                  buttonClass={dropdownItemClass}
                />
              </div>
            </Dropdown>
          )}

          {book.uploadedAt && onDownload && (
            <button
              onClick={onDownload}
              className='flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(126,184,218,0.08)]'
              title={_('Download from Cloud')}
            >
              <MdOutlineCloudDownload className='h-5 w-5 fill-[#8d7450] transition-colors hover:fill-[#7eb8da]' />
            </button>
          )}

          {book.downloadedAt && onUpload && (
            <button
              onClick={onUpload}
              className='flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(126,184,218,0.08)]'
              title={_('Upload to Cloud')}
            >
              <MdOutlineCloudUpload className='h-5 w-5 fill-[#8d7450] transition-colors hover:fill-[#7eb8da]' />
            </button>
          )}

          {book.downloadedAt && onExport && (
            <button
              onClick={onExport}
              className='flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[rgba(185,133,44,0.08)]'
              title={_('Export Book')}
            >
              <MdSaveAlt className='h-5 w-5 fill-[#8d7450] transition-colors hover:fill-[#d4b57b]' />
            </button>
          )}
        </div>
      </div>

      {/* ── Section 2b: Audiobook inline management panel (toggled, not a popup) ── */}
      {showAudiobookPanel && hasAudiobook && (
        <div className='-mt-1 mb-4 rounded-xl border border-[rgba(185,133,44,0.18)] bg-[rgba(16,12,10,0.55)] px-4 py-3'>
          <div className='mb-2.5 flex items-center gap-2.5'>
            <div className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(201,162,39,0.12)]'>
              <MdAudiotrack className='h-4 w-4 text-[#d4b57b]' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[13px] font-medium text-[#e0ceaa]'>
                {audiobookConfig.fileName}
              </p>
            </div>
          </div>
          <div className='flex items-center gap-2 pl-[2.125rem]'>
            <span className='text-[11px] text-[#968671]'>
              {_('Attached')}
              {audiobookConfig.syncStatus && audiobookConfig.syncStatus !== 'none'
                ? ` · ${_(audiobookConfig.syncStatus)}`
                : ''}
            </span>
            <span className='text-[#5e4d38]'>|</span>
            {onReplaceAudiobook && (
              <button
                onClick={onReplaceAudiobook}
                className='text-[11px] font-medium text-[#cfb07a] transition-colors hover:text-[#e4c88e]'
              >
                {_('Replace')}
              </button>
            )}
            {onRemoveAudiobook && (
              <button
                onClick={onRemoveAudiobook}
                className='text-[11px] font-medium text-[#c08070] transition-colors hover:text-[#e8a090]'
              >
                {_('Remove')}
              </button>
            )}
          </div>

          {/* Transcript sub-row */}
          <div className='mt-2.5 flex items-center gap-2.5 pl-[2.125rem]'>
            <div className='flex h-5 w-5 shrink-0 items-center justify-center'>
              <MdOutlineDescription className='h-3.5 w-3.5 text-[#968671]' />
            </div>
            {hasTranscript ? (
              <>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-[12px] text-[#a3937d]'>
                    {audiobookConfig.transcriptFileName}
                  </p>
                </div>
                <span className='text-[#5e4d38]'>|</span>
                {onReplaceTranscript && (
                  <button
                    onClick={onReplaceTranscript}
                    className='text-[11px] font-medium text-[#cfb07a] transition-colors hover:text-[#e4c88e]'
                  >
                    {_('Replace')}
                  </button>
                )}
                {onRemoveTranscript && (
                  <button
                    onClick={onRemoveTranscript}
                    className='text-[11px] font-medium text-[#c08070] transition-colors hover:text-[#e8a090]'
                  >
                    {_('Remove')}
                  </button>
                )}
              </>
            ) : (
              <>
                <span className='text-[11px] text-[#968671]'>{_('No transcript')}</span>
                <span className='text-[#5e4d38]'>|</span>
                {onAddTranscript && (
                  <button
                    onClick={onAddTranscript}
                    className='text-[11px] font-medium text-[#cfb07a] transition-colors hover:text-[#e4c88e]'
                  >
                    {_('Add')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Divider ── */}
      <hr className='border-[rgba(185,133,44,0.10)]' />

      {/* ── Section 3: Metadata ── */}
      <div>
        <button className={sectionHeader} onClick={toggleOthersCollapse}>
          <span className={sectionLabelClass}>{_('Metadata')}</span>
          <span className='text-[#8d7450]'>
            {settings.metadataOthersCollapsed ? (
              <MdExpandMore className='h-4 w-4' />
            ) : (
              <MdExpandLess className='h-4 w-4' />
            )}
          </span>
        </button>
        {!settings.metadataOthersCollapsed && (
          <div className='px-4 pb-3 pt-1'>
            <div className='grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3'>
              <div>
                <span className={fieldLabelClass}>{_('Publisher')}</span>
                <p className={fieldValueClass}>
                  {formatPublisher(metadata?.publisher || '') || '\u2014'}
                </p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Published')}</span>
                <p className={fieldValueClass}>
                  {formatDate(metadata?.published, true) || '\u2014'}
                </p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Updated')}</span>
                <p className={fieldValueClass}>{formatDate(book.updatedAt) || '\u2014'}</p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Added')}</span>
                <p className={fieldValueClass}>{formatDate(book.createdAt) || '\u2014'}</p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Language')}</span>
                <p className={fieldValueClass}>{formatLanguage(metadata?.language) || '\u2014'}</p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Subjects')}</span>
                <p className={clsx(fieldValueClass, 'line-clamp-3')}>
                  {formatAuthors(metadata?.subject || '') || '\u2014'}
                </p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Identifier')}</span>
                <p className={clsx(fieldValueClass, 'line-clamp-1')}>
                  {metadata?.identifier || '\u2014'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 4: Series ── */}
      <div>
        <button className={sectionHeader} onClick={toggleSeriesCollapse}>
          <span className={sectionLabelClass}>{_('Series')}</span>
          <span className='text-[#8d7450]'>
            {settings.metadataSeriesCollapsed ? (
              <MdExpandMore className='h-4 w-4' />
            ) : (
              <MdExpandLess className='h-4 w-4' />
            )}
          </span>
        </button>
        {!settings.metadataSeriesCollapsed && (
          <div className='px-4 pb-3 pt-1'>
            <div className='grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3'>
              <div className='sm:col-span-2'>
                <span className={fieldLabelClass}>{_('Series')}</span>
                <p className={fieldValueClass}>{metadata?.series || '\u2014'}</p>
              </div>
              <div>
                <span className={fieldLabelClass}>{_('Series Index')}</span>
                <p className={fieldValueClass}>{metadata?.seriesIndex || '\u2014'}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 5: Description ── */}
      <div>
        <button className={sectionHeader} onClick={toggleDescriptionCollapse}>
          <span className={sectionLabelClass}>{_('Description')}</span>
          <span className='text-[#8d7450]'>
            {settings.metadataDescriptionCollapsed ? (
              <MdExpandMore className='h-4 w-4' />
            ) : (
              <MdExpandLess className='h-4 w-4' />
            )}
          </span>
        </button>
        {!settings.metadataDescriptionCollapsed && (
          <div className='px-4 pb-2 pt-1'>
            <p
              className='text-[13px] leading-relaxed text-[#b8a88a]'
              dangerouslySetInnerHTML={{
                __html: metadata?.description || _('No description available'),
              }}
            />
          </div>
        )}
      </div>

      {/* ── Section 6: Compact audiobook status (always visible when attached) ── */}
      {hasAudiobook && (
        <div className='mt-3 rounded-xl border border-[rgba(185,133,44,0.14)] bg-[rgba(14,10,8,0.40)] px-4 py-2.5'>
          <div className='flex items-center gap-3'>
            <div className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgba(201,162,39,0.10)]'>
              <MdAudiotrack className='h-3.5 w-3.5 text-[#d4b57b]' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='truncate text-[12px] font-medium text-[#d6c6a8]'>
                {audiobookConfig.fileName}
              </p>
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <span className='text-[11px] text-[#968671]'>{_('Audiobook attached')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookDetailView;
