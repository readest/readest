import React, { useRef, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { BookMetadata } from '@/libs/document';
import { Book } from '@/types/book';
import { KOSyncFilenameFormat } from '@/types/settings';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { saveKOSyncFilename } from '@/services/bookMetadataEdit';
import { formatKOSyncFilename, getKOSyncFilename } from '@/services/sync/KOSyncClient';
import { formatLocaleDateTime, getMetadataHashInfo } from '@/utils/book';
import { clampSyncTimeForDisplay } from '@/utils/time';
import { useCloudSyncStatus, type CloudSyncProviderStatus } from '@/hooks/useCloudSyncStatus';

interface SyncInfoDialogProps {
  isOpen: boolean;
  bookKey: string;
  metadata: BookMetadata | null | undefined;
  storedMetaHash?: string;
  /**
   * Readest Cloud's own most recent sync for this book, across pull + push of
   * config and notes. Every other provider's timestamp is read from settings by
   * {@link useCloudSyncStatus} — this dialog reports them all separately so a
   * user can see which provider is actually keeping up (#5910).
   */
  nativeLastSyncedAt?: number;
  onClose: () => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className='flex flex-col gap-1'>
    <span className='text-base-content/60 text-sm uppercase tracking-wide sm:text-xs'>{label}</span>
    <div className='bg-base-200 text-base-content/90 break-all rounded-md p-2 font-mono text-sm sm:text-xs'>
      {value}
    </div>
  </div>
);

const FILENAME_FORMATS: KOSyncFilenameFormat[] = ['original', 'author-title', 'title-author'];

/**
 * The file name KOSync's File Name checksum hashes for this book, editable so
 * it can match the other reader's file (#7864). A format fills it in; a name
 * equal to the File Name Format's is cleared, so the book follows the format.
 */
const KOSyncFilenameRow: React.FC<{ book: Book; format: KOSyncFilenameFormat }> = ({
  book,
  format,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const inputRef = useRef<HTMLInputElement>(null);
  // A draft exists only while the name is being edited; otherwise the field
  // shows the name hashed now, including one sync brings in while it's open.
  const [draft, setDraft] = useState<string | null>(null);
  const labels: Record<KOSyncFilenameFormat, string> = {
    original: _('Original'),
    'author-title': _('Author - Title'),
    'title-author': _('Title - Author'),
  };

  const save = (name: string) => {
    setDraft(null);
    const trimmed = name.trim();
    const own = trimmed && trimmed !== formatKOSyncFilename(book, format) ? trimmed : undefined;
    if (own !== book.metadata?.kosyncFilename) saveKOSyncFilename(envConfig, book, own);
  };

  // Enter submits the form and the blur saves: Dialog stops keydown from
  // bubbling, so an onKeyDown here would never run.
  return (
    <form
      className='flex flex-col gap-1'
      onSubmit={(e) => {
        e.preventDefault();
        inputRef.current?.blur();
      }}
    >
      <label
        htmlFor='kosync-filename'
        className='text-base-content/60 text-sm uppercase tracking-wide sm:text-xs'
      >
        {_('File Name')}
      </label>
      <input
        ref={inputRef}
        id='kosync-filename'
        type='text'
        dir='auto'
        spellCheck={false}
        value={draft ?? getKOSyncFilename(book, format)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && save(draft)}
        className='input eink-bordered focus:ring-primary/40 h-9 w-full rounded-md font-mono text-sm focus:outline-hidden focus:ring-2 sm:text-xs'
      />
      <div className='flex flex-wrap gap-1'>
        {FILENAME_FORMATS.map((option) => (
          <button
            key={option}
            type='button'
            className='btn btn-ghost btn-sm bg-base-200 eink-bordered font-normal'
            onClick={() => save(formatKOSyncFilename(book, option))}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </form>
  );
};

const SyncInfoDialog: React.FC<SyncInfoDialogProps> = ({
  isOpen,
  bookKey,
  metadata,
  storedMetaHash,
  nativeLastSyncedAt,
  onClose,
}) => {
  const _ = useTranslation();
  const syncStatus = useCloudSyncStatus(nativeLastSyncedAt, bookKey);
  const kosync = useSettingsStore((s) => s.settings.kosync);
  const book = useBookDataStore((s) => s.getBookData(bookKey)?.book);
  const info = metadata ? getMetadataHashInfo(metadata) : undefined;
  const displayHash = storedMetaHash || info?.metaHash || '';
  const placeholder = _('(none)');
  const providerStatusLabel = (provider: CloudSyncProviderStatus): string =>
    provider.syncing
      ? _('Syncing…')
      : provider.failed
        ? _('Sync failed')
        : provider.lastSyncedAt
          ? formatLocaleDateTime(clampSyncTimeForDisplay(provider.lastSyncedAt))
          : _('Never synced');

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      snapHeight={0.7}
      title={_('Sync Info')}
      boxClassName='sm:min-w-[520px]! sm:h-auto'
    >
      {isOpen && (
        <div className='mb-4 mt-0 flex flex-col gap-3 p-2 sm:p-4'>
          <Row label={_('Book Fingerprint')} value={displayHash || placeholder} />
          <Row label={_('Title')} value={info?.title || placeholder} />
          <Row
            label={_('Author')}
            value={info && info.authors.length > 0 ? info.authors.join(', ') : placeholder}
          />
          <Row
            label={_('Identifiers')}
            value={info && info.identifiers.length > 0 ? info.identifiers.join(', ') : placeholder}
          />
          {book && kosync?.enabled && kosync.checksumMethod === 'filename' && (
            <KOSyncFilenameRow book={book} format={kosync.filenameFormat ?? 'original'} />
          )}
          {/* One row per provider the user actually selected. With a single
              provider the row keeps its original "Last Synced" caption; with
              several, each is named so it is clear whose timestamp is whose. */}
          {syncStatus.providers.length === 0 ? (
            <Row label={_('Last Synced')} value={_('Never synced')} />
          ) : syncStatus.providers.length === 1 ? (
            <Row label={_('Last Synced')} value={providerStatusLabel(syncStatus.providers[0]!)} />
          ) : (
            syncStatus.providers.map((provider) => (
              <Row
                key={provider.kind}
                label={_('Last Synced — {{provider}}', { provider: provider.name })}
                value={providerStatusLabel(provider)}
              />
            ))
          )}
        </div>
      )}
    </Dialog>
  );
};

export default SyncInfoDialog;
