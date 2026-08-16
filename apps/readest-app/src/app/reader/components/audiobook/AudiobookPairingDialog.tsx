'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { MdAudiotrack, MdDeleteOutline, MdFolderOpen } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useFileSelector, type SelectedFile } from '@/hooks/useFileSelector';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookDoc } from '@/libs/document';
import {
  buildSequentialAudiobookMappings,
  collectAudiobookTextChapters,
} from '@/services/audiobook/mapping';
import { parseAudiobookFile, type ParsedAudiobookFile } from '@/services/audiobook/metadata';
import {
  importPairedAudiobook,
  removePairedAudiobook,
  type AudiobookImportFile,
} from '@/services/audiobook/storage';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { AudiobookChapter, AudiobookChapterMapping, PairedAudiobook } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

type WizardStep = 'summary' | 'select' | 'anchor' | 'review';

interface AudiobookPairingDialogProps {
  bookKey: string;
  bookDoc: BookDoc;
  onClose: () => void;
}

interface PreparedImportFile extends AudiobookImportFile {
  metadata: ParsedAudiobookFile;
}

const formatTimecode = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const selectedFileName = (selected: SelectedFile): string =>
  selected.file?.name || selected.name || selected.path || '';

const mappingRecord = (mappings: AudiobookChapterMapping[]): Record<string, string> =>
  Object.fromEntries(
    mappings.map(({ ebookChapterId, audioChapterId }) => [ebookChapterId, audioChapterId]),
  );

const StepProgress = ({ current }: { current: number }) => {
  const _ = useTranslation();
  return (
    <div
      className='mb-5 grid grid-cols-3 gap-2'
      role='progressbar'
      aria-label={_('Audiobook pairing progress')}
      aria-valuemin={1}
      aria-valuemax={3}
      aria-valuenow={current}
    >
      {[1, 2, 3].map((step) => (
        <div
          key={step}
          className={clsx(
            'eink-bordered flex h-8 items-center justify-center rounded-md border text-xs font-semibold',
            step <= current
              ? 'border-base-content bg-base-content text-base-100'
              : 'border-base-300 bg-base-100 text-neutral-content',
          )}
        >
          {step}
        </div>
      ))}
    </div>
  );
};

const SurfaceHeader = ({ title, description }: { title: string; description: string }) => (
  <div className='mb-5'>
    <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{title}</h2>
    <p className='text-neutral-content leading-relaxed'>{description}</p>
  </div>
);

const AudiobookPairingDialog = ({ bookKey, bookDoc, onClose }: AudiobookPairingDialogProps) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { selectFiles } = useFileSelector(appService, _);
  const getConfig = useBookDataStore((state) => state.getConfig);
  const getBookData = useBookDataStore((state) => state.getBookData);
  const setConfig = useBookDataStore((state) => state.setConfig);
  const saveConfig = useBookDataStore((state) => state.saveConfig);
  const initialAssociation = getConfig(bookKey)?.audiobook ?? null;
  const [association] = useState<PairedAudiobook | null>(initialAssociation);
  const [step, setStep] = useState<WizardStep>(association ? 'summary' : 'select');
  const [preparedFiles, setPreparedFiles] = useState<PreparedImportFile[]>([]);
  const [selectedEbookChapterId, setSelectedEbookChapterId] = useState('');
  const [selectedAudioChapterId, setSelectedAudioChapterId] = useState('');
  const [mappings, setMappings] = useState<Record<string, string>>(
    mappingRecord(association?.mappings ?? []),
  );
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const ebookChapters = useMemo(() => collectAudiobookTextChapters(bookDoc.toc ?? []), [bookDoc]);
  const importedAudioChapters = useMemo(
    () => preparedFiles.flatMap(({ metadata }) => metadata.chapters),
    [preparedFiles],
  );
  const audioChapters =
    step === 'review' && preparedFiles.length === 0
      ? (association?.chapters ?? [])
      : importedAudioChapters;
  const mappedAudioIds = new Set(Object.values(mappings));
  const mappedCount = Object.keys(mappings).filter((id) => mappings[id]).length;
  const unmappedEbookCount = Math.max(0, ebookChapters.length - mappedCount);
  const unusedAudioCount = audioChapters.filter(
    (chapter) => !mappedAudioIds.has(chapter.id),
  ).length;
  const book = getBookData(bookKey)?.book;
  const busy = !!busyMessage;

  const persistAssociation = async (nextAssociation: PairedAudiobook | undefined) => {
    const current = getConfig(bookKey);
    if (!current) throw new Error(_('Book configuration is unavailable'));
    const viewSettings = {
      ...current.viewSettings,
      ...(nextAssociation ? { ttsUseNarration: true } : {}),
    };
    const updatedConfig = {
      ...current,
      audiobook: nextAssociation,
      viewSettings,
      updatedAt: Date.now(),
    };
    setConfig(bookKey, { audiobook: nextAssociation, viewSettings });
    const liveViewSettings = useReaderStore.getState().getViewSettings(bookKey);
    if (liveViewSettings && nextAssociation) {
      useReaderStore
        .getState()
        .setViewSettings(bookKey, { ...liveViewSettings, ttsUseNarration: true });
    }
    await saveConfig(envConfig, bookKey, updatedConfig, settings);
  };

  const prepareSelectedFiles = async () => {
    if (!appService) return;
    setError('');
    const result = await selectFiles({ type: 'audio', multiple: true });
    if (result.error) {
      setError(result.error);
      return;
    }
    if (!result.files.length) return;
    if (!ebookChapters.length) {
      setError(_('This book has no table of contents to map to audio chapters.'));
      return;
    }

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const selected = [...result.files].sort((a, b) =>
      collator.compare(selectedFileName(a), selectedFileName(b)),
    );
    const nextFiles: PreparedImportFile[] = [];
    try {
      for (let index = 0; index < selected.length; index += 1) {
        setBusyMessage(
          _('Reading audio metadata {{current}} of {{total}}', {
            current: index + 1,
            total: selected.length,
          }),
        );
        const source = selected[index]!;
        const file = source.file ?? (await appService.openFile(source.path!, 'None'));
        const metadata = await parseAudiobookFile(file, `audio-${index}`);
        nextFiles.push({
          file,
          metadata,
          // Native copy avoids routing a multi-hour audiobook through JS.
          // iOS picker URLs are security-scoped, so openFile's cached
          // NativeFile remains the safe copy source there.
          ...(source.path && !appService.isIOSApp ? { sourcePath: source.path } : {}),
        });
      }
      const chapters = nextFiles.flatMap(({ metadata }) => metadata.chapters);
      if (!chapters.length) throw new Error(_('No playable audio chapters were found.'));
      setPreparedFiles(nextFiles);
      setSelectedEbookChapterId(ebookChapters[0]!.id);
      setSelectedAudioChapterId(chapters[0]!.id);
      setMappings({});
      setStep('anchor');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _('Failed to read audiobook files.'));
    } finally {
      setBusyMessage('');
    }
  };

  const buildAutomaticMapping = () => {
    const automatic = buildSequentialAudiobookMappings(
      ebookChapters.map(({ id }) => id),
      importedAudioChapters.map(({ id }) => id),
      {
        ebookChapterId: selectedEbookChapterId,
        audioChapterId: selectedAudioChapterId,
      },
    );
    setMappings(mappingRecord(automatic));
    setStep('review');
  };

  const editExistingMapping = () => {
    setPreparedFiles([]);
    setMappings(mappingRecord(association?.mappings ?? []));
    setStep('review');
  };

  const updateMapping = (ebookChapterId: string, audioChapterId: string) => {
    setMappings((current) => {
      const next = { ...current };
      if (audioChapterId) next[ebookChapterId] = audioChapterId;
      else delete next[ebookChapterId];
      return next;
    });
  };

  const orderedMappings = (): AudiobookChapterMapping[] =>
    ebookChapters.flatMap(({ id }) =>
      mappings[id] ? [{ ebookChapterId: id, audioChapterId: mappings[id] }] : [],
    );

  const savePairing = async () => {
    if (!appService || !book) return;
    setError('');
    setBusyMessage(_('Saving audiobook'));
    try {
      eventDispatcher.dispatch('tts-stop', { bookKey });
      const nextAssociation = preparedFiles.length
        ? await importPairedAudiobook(
            appService,
            book.hash,
            orderedMappings(),
            preparedFiles,
            association ?? undefined,
          )
        : association
          ? { ...association, mappings: orderedMappings() }
          : null;
      if (!nextAssociation) throw new Error(_('Select audiobook files before saving.'));
      await persistAssociation(nextAssociation);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Audiobook paired successfully.'),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _('Failed to save the audiobook.'));
    } finally {
      setBusyMessage('');
    }
  };

  const removePairing = async () => {
    if (!appService || !book || !association) return;
    setError('');
    setBusyMessage(_('Removing audiobook'));
    try {
      eventDispatcher.dispatch('tts-stop', { bookKey });
      await removePairedAudiobook(appService, book.hash, association);
      await persistAssociation(undefined);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Audiobook removed from this device.'),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _('Failed to remove the audiobook.'));
    } finally {
      setBusyMessage('');
    }
  };

  const renderSummary = () => {
    if (!association) return null;
    const totalDuration = association.files.reduce((total, file) => total + file.duration, 0);
    return (
      <>
        <SurfaceHeader
          title={_('Paired Audiobook')}
          description={_('Manage the local recording paired with this ebook.')}
        />
        <div className='eink-bordered border-base-200 bg-base-100 mb-5 rounded-lg border'>
          <div className='flex min-h-14 items-center gap-3 px-4 py-3'>
            <span className='bg-base-200 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full'>
              <MdAudiotrack className='h-5 w-5' />
            </span>
            <div className='min-w-0 flex-1'>
              <p className='truncate font-medium'>{association.title || book?.title}</p>
              <p className='text-neutral-content text-[0.85em]'>
                {_('{{files}} files · {{chapters}} audio chapters · {{duration}}', {
                  files: association.files.length,
                  chapters: association.chapters.length,
                  duration: formatTimecode(totalDuration),
                })}
              </p>
            </div>
          </div>
        </div>
        {confirmRemove ? (
          <div className='eink-bordered border-error/50 bg-base-100 mb-5 rounded-lg border p-4'>
            <p className='font-medium'>{_('Remove audiobook files from this device?')}</p>
            <p className='text-neutral-content mt-1 text-[0.85em]'>
              {_('The ebook, notes, and reading progress will be kept.')}
            </p>
            <div className='mt-4 flex justify-end gap-2'>
              <button
                className='btn btn-ghost'
                disabled={busy}
                onClick={() => setConfirmRemove(false)}
              >
                {_('Cancel')}
              </button>
              <button className='btn btn-error' disabled={busy} onClick={removePairing}>
                {_('Remove')}
              </button>
            </div>
          </div>
        ) : (
          <div className='flex flex-wrap justify-end gap-2'>
            <button
              className='btn btn-ghost text-error'
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              <MdDeleteOutline className='h-5 w-5' />
              {_('Remove')}
            </button>
            <button className='btn btn-ghost' disabled={busy} onClick={() => setStep('select')}>
              {_('Replace Audio')}
            </button>
            <button className='btn btn-contrast' disabled={busy} onClick={editExistingMapping}>
              {_('Edit Mapping')}
            </button>
          </div>
        )}
      </>
    );
  };

  const renderSelect = () => (
    <>
      <StepProgress current={1} />
      <SurfaceHeader
        title={_('Choose Audiobook Files')}
        description={_('Select one M4B file or a set of MP3 or M4A tracks in playback order.')}
      />
      <button
        type='button'
        onClick={prepareSelectedFiles}
        disabled={busy}
        className={clsx(
          'eink-bordered group flex min-h-28 w-full flex-col items-center justify-center gap-3',
          'border-base-200 bg-base-100 rounded-lg border px-6 py-5',
          'hover:border-base-300 hover:bg-base-200/60 transition-colors duration-150',
          'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
        )}
      >
        <span className='bg-base-200 group-hover:bg-base-content group-hover:text-base-100 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150'>
          <MdFolderOpen className='h-6 w-6' />
        </span>
        <span className='font-medium'>{_('Select Audio Files')}</span>
        <span className='text-neutral-content text-[0.85em]'>MP3 · M4A · M4B</span>
      </button>
      {association && (
        <div className='mt-5 flex justify-start'>
          <button className='btn btn-ghost' disabled={busy} onClick={() => setStep('summary')}>
            {_('Back')}
          </button>
        </div>
      )}
    </>
  );

  const renderAnchor = () => (
    <>
      <StepProgress current={2} />
      <SurfaceHeader
        title={_('Align One Chapter')}
        description={_(
          'Choose one known match. Readest will map the remaining chapters sequentially from it.',
        )}
      />
      <div className='eink-bordered border-base-200 bg-base-100 divide-base-200 mb-5 rounded-lg border divide-y'>
        <label className='flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
          <span className='font-medium'>{_('Ebook chapter')}</span>
          <select
            className='select select-bordered eink-bordered settings-content w-full sm:max-w-[60%]'
            value={selectedEbookChapterId}
            onChange={(event) => setSelectedEbookChapterId(event.target.value)}
          >
            {ebookChapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.label}
              </option>
            ))}
          </select>
        </label>
        <label className='flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
          <span className='font-medium'>{_('Audio chapter or track')}</span>
          <select
            className='select select-bordered eink-bordered settings-content w-full sm:max-w-[60%]'
            value={selectedAudioChapterId}
            onChange={(event) => setSelectedAudioChapterId(event.target.value)}
          >
            {importedAudioChapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.label} · {formatTimecode(chapter.end - chapter.start)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {ebookChapters.length !== importedAudioChapters.length && (
        <p className='bg-base-200/60 text-neutral-content mb-5 rounded-lg px-4 py-3 text-[0.85em]'>
          {_(
            '{{ebook}} ebook chapters and {{audio}} audio chapters were found. Unmatched items will stay unpaired.',
            {
              ebook: ebookChapters.length,
              audio: importedAudioChapters.length,
            },
          )}
        </p>
      )}
      <div className='flex justify-end gap-2'>
        <button className='btn btn-ghost' disabled={busy} onClick={() => setStep('select')}>
          {_('Back')}
        </button>
        <button
          className='btn btn-contrast'
          disabled={!selectedEbookChapterId || !selectedAudioChapterId || busy}
          onClick={buildAutomaticMapping}
        >
          {_('Review Mapping')}
        </button>
      </div>
    </>
  );

  const chapterOptionLabel = (chapter: AudiobookChapter) =>
    `${chapter.label} · ${formatTimecode(chapter.end - chapter.start)}`;

  const renderReview = () => (
    <>
      <StepProgress current={3} />
      <SurfaceHeader
        title={_('Review Chapter Mapping')}
        description={_(
          'Adjust any row, reuse an audio chapter, or leave an ebook chapter without audio.',
        )}
      />
      {(unmappedEbookCount > 0 || unusedAudioCount > 0) && (
        <p className='bg-base-200/60 text-neutral-content mb-4 rounded-lg px-4 py-3 text-[0.85em]'>
          {_(
            '{{mapped}} mapped · {{unmapped}} ebook chapters without audio · {{unused}} unused audio chapters',
            {
              mapped: mappedCount,
              unmapped: unmappedEbookCount,
              unused: unusedAudioCount,
            },
          )}
        </p>
      )}
      <div className='eink-bordered border-base-200 bg-base-100 divide-base-200 mb-5 rounded-lg border divide-y'>
        {ebookChapters.map((chapter) => (
          <label
            key={chapter.id}
            className='flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
          >
            <span className='min-w-0 font-medium sm:max-w-[38%] sm:truncate' title={chapter.label}>
              {chapter.label}
            </span>
            <select
              aria-label={_('Audio for {{chapter}}', { chapter: chapter.label })}
              className='select select-bordered eink-bordered settings-content w-full sm:max-w-[60%]'
              value={mappings[chapter.id] ?? ''}
              onChange={(event) => updateMapping(chapter.id, event.target.value)}
            >
              <option value=''>{_('No audio')}</option>
              {audioChapters.map((audioChapter) => (
                <option key={audioChapter.id} value={audioChapter.id}>
                  {chapterOptionLabel(audioChapter)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className='flex justify-end gap-2'>
        <button
          className='btn btn-ghost'
          disabled={busy}
          onClick={() => setStep(preparedFiles.length ? 'anchor' : 'summary')}
        >
          {_('Back')}
        </button>
        <button
          className='btn btn-contrast'
          disabled={mappedCount === 0 || busy}
          onClick={savePairing}
        >
          {_('Create Association')}
        </button>
      </div>
    </>
  );

  return (
    <Dialog
      id='audiobook-pairing-dialog'
      isOpen
      dismissible={!busy}
      title={_('Audiobook')}
      onClose={onClose}
      boxClassName='sm:h-[80%] sm:min-w-[620px] sm:max-w-[720px]'
      contentClassName='!px-6 sm:!px-8'
      useOverlayScroll
    >
      <div className='pb-6 pt-2'>
        {busyMessage && (
          <div
            className='bg-base-200/60 mb-4 flex items-center gap-3 rounded-lg px-4 py-3'
            role='status'
          >
            <span className='loading loading-spinner loading-sm' />
            <span>{busyMessage}</span>
          </div>
        )}
        {error && (
          <div
            className='eink-bordered border-error/50 bg-base-100 text-error mb-4 rounded-lg border px-4 py-3'
            role='alert'
          >
            {error}
          </div>
        )}
        {step === 'summary' && renderSummary()}
        {step === 'select' && renderSelect()}
        {step === 'anchor' && renderAnchor()}
        {step === 'review' && renderReview()}
      </div>
    </Dialog>
  );
};

export default AudiobookPairingDialog;
