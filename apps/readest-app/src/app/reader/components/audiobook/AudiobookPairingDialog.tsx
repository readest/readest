'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MdArrowDropDown,
  MdAudiotrack,
  MdDeleteOutline,
  MdFolderOpen,
  MdHeadphones,
  MdPlayArrow,
  MdStop,
} from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useFileSelector, type SelectedFile } from '@/hooks/useFileSelector';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookDoc } from '@/libs/document';
import {
  absPreviewClip,
  listPairableAbsBooks,
  loadAbsPairingSource,
  type AbsPairingSource,
} from '@/services/audiobook/absPairing';
import {
  buildSequentialAudiobookMappings,
  collectAudiobookTextChapters,
} from '@/services/audiobook/mapping';
import { parseAudiobookFile, type ParsedAudiobookFile } from '@/services/audiobook/metadata';
import { AudiobookPreviewPlayer, type AudiobookPreviewClip } from '@/services/audiobook/preview';
import {
  persistStreamedPairedAudiobook,
  replacePairedAudiobook,
  removePairedAudiobook,
  type AudiobookImportFile,
} from '@/services/audiobook/storage';
import { findABSServerById } from '@/store/absServerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type {
  AudiobookChapter,
  AudiobookChapterMapping,
  Book,
  PairedAudiobook,
} from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import AudiobookChapterPicker, { formatAudiobookTimecode } from './AudiobookChapterPicker';
import StepProgress from './AudiobookStepProgress';

type WizardStep = 'summary' | 'select' | 'abs' | 'anchor' | 'review';

interface AudiobookPairingDialogProps {
  bookKey: string;
  bookDoc: BookDoc;
  onClose: () => void;
}

interface PreparedImportFile extends AudiobookImportFile {
  metadata: ParsedAudiobookFile;
  previewPath?: string;
}

const selectedFileName = (selected: SelectedFile): string =>
  selected.file?.name || selected.name || selected.path || '';

const mappingRecord = (mappings: AudiobookChapterMapping[]): Record<string, string> =>
  Object.fromEntries(
    mappings.map(({ ebookChapterId, audioChapterId }) => [ebookChapterId, audioChapterId]),
  );

const SurfaceHeader = ({ title, description }: { title: string; description: string }) => (
  <div className='mb-5'>
    <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{title}</h2>
    <p className='text-neutral-content leading-relaxed'>{description}</p>
  </div>
);

const WizardActions = ({ children }: { children: ReactNode }) => (
  <div className='border-base-200 bg-base-100 sticky bottom-0 z-10 -mx-6 mt-5 flex justify-end gap-2 border-t px-6 py-4 sm:-mx-8 sm:px-8'>
    {children}
  </div>
);

const closeFiles = async (files: File[]) => {
  await Promise.allSettled(
    files.map((file) => {
      const close = (file as File & { close?: () => Promise<void> }).close;
      return close ? close.call(file) : Promise.resolve();
    }),
  );
};

const nativeFilePath = (file: File): string | undefined => {
  const getNativeLocation = (file as File & { getNativeLocation?: () => { path: string } })
    .getNativeLocation;
  return getNativeLocation?.call(file).path;
};

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
  const [preparedAbs, setPreparedAbs] = useState<AbsPairingSource | null>(null);
  const [absBooks, setAbsBooks] = useState<Book[]>([]);
  const [absQuery, setAbsQuery] = useState('');
  const [selectedEbookChapterId, setSelectedEbookChapterId] = useState('');
  const [selectedAudioChapterId, setSelectedAudioChapterId] = useState('');
  const [mappings, setMappings] = useState<Record<string, string>>(
    mappingRecord(association?.mappings ?? []),
  );
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [activeMappingChapterId, setActiveMappingChapterId] = useState<string | null>(null);
  const [previewingAudioChapterId, setPreviewingAudioChapterId] = useState<string | null>(null);
  const previewPlayerRef = useRef<AudiobookPreviewPlayer | null>(null);

  const ebookChapters = useMemo(() => collectAudiobookTextChapters(bookDoc.toc ?? []), [bookDoc]);
  const importedAudioChapters = useMemo(
    () => preparedAbs?.chapters ?? preparedFiles.flatMap(({ metadata }) => metadata.chapters),
    [preparedAbs, preparedFiles],
  );
  const hasPreparedSource = preparedFiles.length > 0 || preparedAbs !== null;
  const audioChapters =
    step === 'review' && !hasPreparedSource ? (association?.chapters ?? []) : importedAudioChapters;
  // Where the audio for a preview comes from: the source being prepared, else
  // the saved pairing whose mapping is being edited.
  const previewAbsSource = preparedAbs?.source ?? (hasPreparedSource ? null : association?.source);
  const filteredAbsBooks = useMemo(() => {
    const normalized = absQuery.trim().toLocaleLowerCase();
    if (!normalized) return absBooks;
    return absBooks.filter(
      (candidate) =>
        candidate.title.toLocaleLowerCase().includes(normalized) ||
        candidate.author.toLocaleLowerCase().includes(normalized),
    );
  }, [absBooks, absQuery]);
  const audioChapterById = new Map(audioChapters.map((chapter) => [chapter.id, chapter]));
  const mappedAudioIds = new Set(Object.values(mappings));
  const mappedCount = Object.keys(mappings).filter((id) => mappings[id]).length;
  const unmappedEbookCount = Math.max(0, ebookChapters.length - mappedCount);
  const unusedAudioCount = audioChapters.filter(
    (chapter) => !mappedAudioIds.has(chapter.id),
  ).length;
  const book = getBookData(bookKey)?.book;
  const busy = !!busyMessage;

  useEffect(() => {
    if (!appService) return;
    const player = new AudiobookPreviewPlayer(appService, (chapterId) => {
      setPreviewingAudioChapterId((current) => (current === chapterId ? null : current));
    });
    previewPlayerRef.current = player;
    return () => {
      previewPlayerRef.current = null;
      void player.dispose();
    };
  }, [appService]);

  useEffect(
    () => () => {
      void closeFiles(preparedFiles.map(({ file }) => file));
    },
    [preparedFiles],
  );

  // The reader does not always have the library loaded (a deep link opens a
  // book directly), so read it from disk when the store is empty.
  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    const { library, libraryLoaded } = useLibraryStore.getState();
    void (async () => {
      const books = libraryLoaded ? library : await appService.loadLibraryBooks();
      if (!cancelled) setAbsBooks(listPairableAbsBooks(books));
    })();
    return () => {
      cancelled = true;
    };
  }, [appService]);

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
    await saveConfig(envConfig, bookKey, updatedConfig, settings);
    setConfig(bookKey, { audiobook: nextAssociation, viewSettings });
    const liveViewSettings = useReaderStore.getState().getViewSettings(bookKey);
    if (liveViewSettings && nextAssociation) {
      useReaderStore
        .getState()
        .setViewSettings(bookKey, { ...liveViewSettings, ttsUseNarration: true });
    }
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
    const openedFiles: File[] = [];
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
        openedFiles.push(file);
        const metadata = await parseAudiobookFile(file, `audio-${index}`);
        nextFiles.push({
          file,
          metadata,
          ...(nativeFilePath(file) || source.path
            ? { previewPath: nativeFilePath(file) ?? source.path }
            : {}),
          // Native copy avoids routing a multi-hour audiobook through JS.
          // iOS picker URLs are security-scoped, so openFile's cached
          // NativeFile remains the safe copy source there.
          ...(source.path && !appService.isIOSApp ? { sourcePath: source.path } : {}),
        });
      }
      const chapters = nextFiles.flatMap(({ metadata }) => metadata.chapters);
      if (!chapters.length) throw new Error(_('No playable audio chapters were found.'));
      setPreparedAbs(null);
      setPreparedFiles(nextFiles);
      setSelectedEbookChapterId(ebookChapters[0]!.id);
      setSelectedAudioChapterId(chapters[0]!.id);
      setMappings({});
      setStep('anchor');
    } catch (cause) {
      await closeFiles(openedFiles);
      setError(cause instanceof Error ? cause.message : _('Failed to read audiobook files.'));
    } finally {
      setBusyMessage('');
    }
  };

  const chooseAbsBook = async (candidate: Book) => {
    if (!appService) return;
    setError('');
    if (!ebookChapters.length) {
      setError(_('This book has no table of contents to map to audio chapters.'));
      return;
    }
    setBusyMessage(_('Loading audiobook chapters'));
    try {
      await previewPlayerRef.current?.stop();
      const source = await loadAbsPairingSource(appService, candidate);
      setPreparedFiles([]);
      setPreparedAbs(source);
      setSelectedEbookChapterId(ebookChapters[0]!.id);
      setSelectedAudioChapterId(source.chapters[0]!.id);
      setMappings({});
      setStep('anchor');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : _('Failed to load the audiobook.'));
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
    setPreparedAbs(null);
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

  const togglePreview = async (chapter: AudiobookChapter) => {
    if (!appService || !previewPlayerRef.current) return;
    setError('');
    const prepared = preparedFiles.find(({ metadata }) => metadata.id === chapter.fileId);
    const stored = association?.files.find((file) => file.id === chapter.fileId);
    try {
      await eventDispatcher.dispatch('tts-stop', { bookKey });
      let clip: Omit<AudiobookPreviewClip, 'id'>;
      if (previewAbsSource) {
        // Chapter times are global; the preview plays the file holding the start.
        const remote = absPreviewClip(previewAbsSource, chapter.start);
        if (!remote) throw new Error(_('Audiobookshelf server not found'));
        // A chapter can continue into the next track; keep the preview within
        // the file it starts in so it does not run off the end of the clip.
        const withinTrack = Math.min(chapter.end - chapter.start, remote.duration - remote.start);
        clip = {
          url: remote.url,
          start: remote.start,
          end: remote.start + withinTrack,
        };
      } else {
        clip = {
          ...(prepared?.previewPath
            ? { path: prepared.previewPath, base: 'None' as const }
            : stored
              ? { path: stored.path, base: 'Books' as const }
              : prepared
                ? { file: prepared.file }
                : {}),
          start: chapter.start,
          end: chapter.end,
        };
      }
      const playing = await previewPlayerRef.current.toggle({ id: chapter.id, ...clip });
      setPreviewingAudioChapterId(playing ? chapter.id : null);
    } catch (cause) {
      setPreviewingAudioChapterId(null);
      setError(cause instanceof Error ? cause.message : _('Failed to preview the audiobook.'));
    }
  };

  const savePairing = async () => {
    if (!appService || !book) return;
    setError('');
    setBusyMessage(_('Saving audiobook'));
    try {
      await eventDispatcher.dispatch('tts-stop', { bookKey });
      await previewPlayerRef.current?.stop();
      let nextAssociation: PairedAudiobook | null;
      if (preparedAbs) {
        nextAssociation = await persistStreamedPairedAudiobook(
          appService,
          book.hash,
          {
            version: 1,
            ...(preparedAbs.title ? { title: preparedAbs.title } : {}),
            ...(preparedAbs.narrator ? { narrator: preparedAbs.narrator } : {}),
            files: preparedAbs.files,
            chapters: preparedAbs.chapters,
            mappings: orderedMappings(),
            createdAt: Math.max(Date.now(), (association?.createdAt ?? 0) + 1),
            source: preparedAbs.source,
          },
          association ?? undefined,
          persistAssociation,
        );
      } else if (preparedFiles.length) {
        nextAssociation = await replacePairedAudiobook(
          appService,
          book.hash,
          orderedMappings(),
          preparedFiles,
          association ?? undefined,
          persistAssociation,
        );
      } else {
        nextAssociation = association ? { ...association, mappings: orderedMappings() } : null;
        if (nextAssociation) await persistAssociation(nextAssociation);
      }
      if (!nextAssociation) throw new Error(_('Select audiobook files before saving.'));
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
      await eventDispatcher.dispatch('tts-stop', { bookKey });
      await previewPlayerRef.current?.stop();
      await removePairedAudiobook(appService, book.hash, association, persistAssociation);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: association.source
          ? _('Audiobook unpaired.')
          : _('Audiobook removed from this device.'),
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
    const streamedFrom = association.source
      ? (findABSServerById(association.source.serverId)?.name ?? 'Audiobookshelf')
      : null;
    return (
      <>
        <SurfaceHeader
          title={_('Paired Audiobook')}
          description={
            streamedFrom
              ? _('Manage the Audiobookshelf audiobook paired with this ebook.')
              : _('Manage the local recording paired with this ebook.')
          }
        />
        <div className='eink-bordered border-base-200 bg-base-100 mb-5 rounded-lg border'>
          <div className='flex min-h-14 items-center gap-3 px-4 py-3'>
            <span className='bg-base-200 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full'>
              {streamedFrom ? (
                <MdHeadphones className='h-5 w-5' />
              ) : (
                <MdAudiotrack className='h-5 w-5' />
              )}
            </span>
            <div className='min-w-0 flex-1'>
              <p className='truncate font-medium'>{association.title || book?.title}</p>
              <p className='text-neutral-content text-[0.85em]'>
                {streamedFrom
                  ? _('{{chapters}} audio chapters · {{duration}} · Streamed from {{server}}', {
                      chapters: association.chapters.length,
                      duration: formatAudiobookTimecode(totalDuration),
                      server: streamedFrom,
                    })
                  : _('{{files}} files · {{chapters}} audio chapters · {{duration}}', {
                      files: association.files.length,
                      chapters: association.chapters.length,
                      duration: formatAudiobookTimecode(totalDuration),
                    })}
              </p>
            </div>
          </div>
        </div>
        {confirmRemove ? (
          <div className='eink-bordered border-error/50 bg-base-100 mb-5 rounded-lg border p-4'>
            <p className='font-medium'>
              {streamedFrom
                ? _('Unpair this audiobook?')
                : _('Remove audiobook files from this device?')}
            </p>
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
        title={_('Pair Audiobook')}
        description={_(
          'Pair a local recording with “{{book}}”. Select one M4B file or a set of MP3 or M4A tracks in playback order.',
          { book: book?.title ?? _('this ebook') },
        )}
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
      {absBooks.length > 0 && (
        <button
          type='button'
          onClick={() => setStep('abs')}
          disabled={busy}
          className={clsx(
            'eink-bordered group mt-4 flex min-h-28 w-full flex-col items-center justify-center gap-3',
            'border-base-200 bg-base-100 rounded-lg border px-6 py-5',
            'hover:border-base-300 hover:bg-base-200/60 transition-colors duration-150',
            'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          <span className='bg-base-200 group-hover:bg-base-content group-hover:text-base-100 flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150'>
            <MdHeadphones className='h-6 w-6' />
          </span>
          <span className='font-medium'>{_('Choose from Audiobookshelf')}</span>
          <span className='text-neutral-content text-[0.85em]'>
            {_('Streamed from your server, nothing to download')}
          </span>
        </button>
      )}
      {association && (
        <div className='mt-5 flex justify-start'>
          <button className='btn btn-ghost' disabled={busy} onClick={() => setStep('summary')}>
            {_('Back')}
          </button>
        </div>
      )}
    </>
  );

  const renderAbsPicker = () => (
    <>
      <StepProgress current={1} />
      <SurfaceHeader
        title={_('Choose Audiobook')}
        description={_('Pick the Audiobookshelf audiobook to pair with “{{book}}”.', {
          book: book?.title ?? _('this ebook'),
        })}
      />
      <div className='eink-bordered border-base-200 bg-base-100 mb-5 overflow-hidden rounded-lg border'>
        <div className='border-base-200 border-b p-2'>
          <input
            type='search'
            className='input input-sm eink-bordered w-full'
            aria-label={_('Search audiobooks')}
            placeholder={_('Search audiobooks')}
            value={absQuery}
            onChange={(event) => setAbsQuery(event.target.value)}
          />
        </div>
        <div className='divide-base-200 max-h-80 overflow-y-auto divide-y' role='list'>
          {filteredAbsBooks.map((candidate) => (
            <button
              key={candidate.hash}
              type='button'
              role='listitem'
              className='hover:bg-base-200 flex min-h-14 w-full items-center gap-3 px-4 py-2 text-start'
              disabled={busy}
              onClick={() => chooseAbsBook(candidate)}
            >
              <span className='bg-base-200 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full'>
                <MdHeadphones className='h-5 w-5' />
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate font-medium'>{candidate.title}</span>
                <span className='text-neutral-content block truncate text-[0.85em]'>
                  {[
                    candidate.author,
                    candidate.duration && formatAudiobookTimecode(candidate.duration),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          ))}
          {filteredAbsBooks.length === 0 && (
            <p className='text-neutral-content px-3 py-5 text-center text-sm'>
              {_('No matching audiobooks')}
            </p>
          )}
        </div>
      </div>
      <WizardActions>
        <button
          className='btn btn-ghost eink-bordered'
          disabled={busy}
          onClick={() => setStep('select')}
        >
          {_('Back')}
        </button>
      </WizardActions>
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
        <div className='flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
          <label className='font-medium' htmlFor='audiobook-ebook-anchor'>
            {_('Ebook chapter')}
          </label>
          <div className='hover:bg-base-200/60 focus-within:bg-base-200/60 flex w-full items-center rounded-md sm:max-w-[60%]'>
            <select
              id='audiobook-ebook-anchor'
              className='select h-9 min-w-0 flex-1 cursor-pointer !appearance-none truncate !border-0 !bg-transparent !bg-none !pe-1 !ps-2 text-end focus:!border-0 focus:!shadow-none focus:!outline-none focus:!ring-0'
              value={selectedEbookChapterId}
              onChange={(event) => setSelectedEbookChapterId(event.target.value)}
            >
              {ebookChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.label}
                </option>
              ))}
            </select>
            <MdArrowDropDown
              aria-hidden='true'
              className='text-base-content/55 pointer-events-none h-5 w-5 flex-shrink-0'
            />
          </div>
        </div>
        <div className='flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'>
          <label className='font-medium' htmlFor='audiobook-audio-anchor'>
            {_('Audio chapter or track')}
          </label>
          <div className='flex w-full items-center sm:max-w-[60%]'>
            <div className='hover:bg-base-200/60 focus-within:bg-base-200/60 flex min-w-0 flex-1 items-center rounded-md'>
              <select
                id='audiobook-audio-anchor'
                className='select h-9 min-w-0 flex-1 cursor-pointer !appearance-none truncate !border-0 !bg-transparent !bg-none !pe-1 !ps-2 text-end focus:!border-0 focus:!shadow-none focus:!outline-none focus:!ring-0'
                value={selectedAudioChapterId}
                onChange={(event) => setSelectedAudioChapterId(event.target.value)}
              >
                {importedAudioChapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.label} · {formatAudiobookTimecode(chapter.end - chapter.start)}
                  </option>
                ))}
              </select>
              <MdArrowDropDown
                aria-hidden='true'
                className='text-base-content/55 pointer-events-none h-5 w-5 flex-shrink-0'
              />
            </div>
            {audioChapterById.get(selectedAudioChapterId) && (
              <button
                type='button'
                className='btn btn-ghost btn-sm btn-square flex-shrink-0'
                aria-label={
                  previewingAudioChapterId === selectedAudioChapterId
                    ? _('Stop audio preview')
                    : _('Preview selected audio chapter')
                }
                onClick={() => togglePreview(audioChapterById.get(selectedAudioChapterId)!)}
              >
                {previewingAudioChapterId === selectedAudioChapterId ? (
                  <MdStop className='h-5 w-5' />
                ) : (
                  <MdPlayArrow className='h-5 w-5' />
                )}
              </button>
            )}
          </div>
        </div>
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
      <WizardActions>
        <button
          className='btn btn-ghost'
          disabled={busy}
          onClick={() => setStep(preparedAbs ? 'abs' : 'select')}
        >
          {_('Back')}
        </button>
        <button
          className='btn btn-contrast'
          disabled={!selectedEbookChapterId || !selectedAudioChapterId || busy}
          onClick={buildAutomaticMapping}
        >
          {_('Review Mapping')}
        </button>
      </WizardActions>
    </>
  );

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
        {ebookChapters.map((chapter) => {
          const mappedId = mappings[chapter.id] ?? '';
          const mappedAudio = audioChapterById.get(mappedId);
          const pickerOpen = activeMappingChapterId === chapter.id;
          return (
            <div
              key={chapter.id}
              className='flex min-h-16 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between'
            >
              <span
                className='min-w-0 pt-2 font-medium sm:max-w-[38%] sm:truncate'
                title={chapter.label}
              >
                {chapter.label}
              </span>
              <div className='w-full sm:max-w-[60%]'>
                <div className='flex min-h-10 items-center'>
                  <button
                    type='button'
                    className='hover:bg-base-200 flex min-w-0 flex-1 items-center rounded-md px-2 py-2 text-start'
                    aria-label={_('Audio for {{chapter}}', { chapter: chapter.label })}
                    aria-haspopup='listbox'
                    aria-expanded={pickerOpen}
                    onClick={() =>
                      setActiveMappingChapterId((current) =>
                        current === chapter.id ? null : chapter.id,
                      )
                    }
                  >
                    <span className='min-w-0 flex-1 truncate text-sm'>
                      {mappedAudio
                        ? `${mappedAudio.label} · ${formatAudiobookTimecode(mappedAudio.end - mappedAudio.start)}`
                        : _('No audio')}
                    </span>
                    <MdArrowDropDown className='h-5 w-5 flex-shrink-0' />
                  </button>
                  {mappedAudio && (
                    <button
                      type='button'
                      className='btn btn-ghost btn-sm btn-square flex-shrink-0'
                      aria-label={
                        previewingAudioChapterId === mappedAudio.id
                          ? _('Stop previewing {{chapter}}', { chapter: mappedAudio.label })
                          : _('Preview {{chapter}}', { chapter: mappedAudio.label })
                      }
                      onClick={() => togglePreview(mappedAudio)}
                    >
                      {previewingAudioChapterId === mappedAudio.id ? (
                        <MdStop className='h-5 w-5' />
                      ) : (
                        <MdPlayArrow className='h-5 w-5' />
                      )}
                    </button>
                  )}
                </div>
                {pickerOpen && (
                  <AudiobookChapterPicker
                    chapters={audioChapters}
                    value={mappedId}
                    previewingId={previewingAudioChapterId}
                    onSelect={(audioChapterId) => {
                      updateMapping(chapter.id, audioChapterId);
                      setActiveMappingChapterId(null);
                    }}
                    onPreview={togglePreview}
                    onClose={() => setActiveMappingChapterId(null)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <WizardActions>
        <button
          className='btn btn-ghost'
          disabled={busy}
          onClick={() => setStep(hasPreparedSource ? 'anchor' : 'summary')}
        >
          {_('Back')}
        </button>
        <button
          className='btn btn-contrast'
          disabled={mappedCount === 0 || busy}
          onClick={savePairing}
        >
          {association ? _('Save Changes') : _('Pair Audiobook')}
        </button>
      </WizardActions>
    </>
  );

  return (
    <Dialog
      id='audiobook-pairing-dialog'
      isOpen
      dismissible={!busy}
      title={association ? _('Manage Audiobook') : _('Pair Audiobook')}
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
        {step === 'abs' && renderAbsPicker()}
        {step === 'anchor' && renderAnchor()}
        {step === 'review' && renderReview()}
      </div>
    </Dialog>
  );
};

export default AudiobookPairingDialog;
