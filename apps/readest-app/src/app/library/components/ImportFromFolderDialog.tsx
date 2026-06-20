import clsx from 'clsx';
import React, { useState } from 'react';
import { MdFolderOpen } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import Dialog from '@/components/Dialog';

/**
 * Per-extension grouping presented to the user. Each card is a single
 * checkbox in the dialog whose underlying value is one or more entries
 * from {@link import('@/services/constants').SUPPORTED_BOOK_EXTS}. The
 * label is what the user sees; `exts` is what the importer filters on.
 *
 * Keep order roughly aligned with the design mockup so the muscle memory
 * of users coming from the prior screenshot still works (EPUB and PDF
 * first, common eBook formats in the middle, archives at the end).
 */
export interface FormatGroup {
  id: string;
  label: string;
  /** lower-case extensions without the leading dot. */
  exts: string[];
}

export const DEFAULT_FORMAT_GROUPS: FormatGroup[] = [
  { id: 'epub', label: 'EPUB', exts: ['epub'] },
  { id: 'pdf', label: 'PDF', exts: ['pdf'] },
  { id: 'mobi', label: 'MOBI/AZW/AZW3', exts: ['mobi', 'azw', 'azw3'] },
  { id: 'fb2', label: 'FB2', exts: ['fb2'] },
  { id: 'cbz', label: 'CBZ/ZIP', exts: ['cbz', 'zip'] },
  { id: 'txt', label: 'TXT', exts: ['txt'] },
];

export interface ImportFromFolderResult {
  directory: string;
  /** Lower-case file extensions (without the leading dot) to include. */
  extensions: string[];
  /**
   * IDs of the {@link FormatGroup}s the user ticked. Forwarded so the
   * caller can persist the user's selection at the group level (rather
   * than having to reverse-engineer it from {@link extensions}).
   */
  selectedGroupIds: string[];
  /**
   * Minimum file size in KB — files strictly smaller than `minSizeKB *
   * 1024` bytes are skipped by the importer. `0` keeps everything.
   * Stored in KB (not bytes) because that matches the dialog's input
   * and the persistence format; callers that need bytes should
   * multiply by 1024 themselves.
   */
  minSizeKB: number;
  /**
   * When `false` (default), each first-level subfolder under
   * {@link directory} becomes its own library group, mirroring the
   * folder structure. When `true`, every matching file is dropped
   * directly into the library root without creating any groups.
   */
  flatten: boolean;
  /**
   * When `true`, register the directory as an external library folder
   * (`settings.externalLibraryFolders`) and import its books in place
   * — Readest will read each file straight from its original location
   * instead of copying it into Books/<hash>/. Sidecars (cover, config,
   * notes) still live in Readest's data dir, so deleting the local
   * copy of a book on Readest's side will physically remove the
   * source file under the registered folder. Defaults to `false`,
   * which keeps the legacy "copy into Readest" behaviour and leaves
   * the registered folder list untouched.
   */
  readInPlace: boolean;
}

interface ImportFromFolderDialogProps {
  /** Initial directory shown in the path field; the user can change it. */
  initialDirectory: string;
  /**
   * Initial value for the folder-structure radios. Persisted by the
   * caller across dialog opens so users don't have to re-pick the same
   * mode every time. Defaults to `'keep'` when omitted.
   */
  initialFolderMode?: 'keep' | 'flatten';
  /**
   * Initial set of {@link FormatGroup.id}s to mark as checked. Persisted
   * by the caller. Falls back to a sensible "EPUB + PDF" default when
   * omitted (or when the persisted set is empty, since no boxes ticked
   * would block the OK button immediately on dialog open).
   */
  initialSelectedGroupIds?: string[];
  /**
   * Initial value for the "File size larger than" input, in KB.
   * Defaults to 20 KB when omitted.
   */
  initialMinSizeKB?: number;
  /**
   * Initial value for the "Read in place" toggle. Persisted by the
   * caller so users who picked in-place last time don't need to flip
   * the switch again. Defaults to `false`.
   */
  initialReadInPlace?: boolean;
  /**
   * Predicate the dialog uses to decide whether the currently-displayed
   * folder is already registered as an external library folder. When
   * `true`, the "Read in place" toggle is forced ON and locked, with a
   * note explaining that imports from this folder are always in-place
   * (until the user removes it from Settings, which v1 doesn't expose).
   * Implementations should match by exact string after the same path
   * normalization the importer uses.
   */
  isRegisteredExternalRoot?: (directory: string) => boolean;
  /**
   * Pop the platform's native folder picker and return the chosen path,
   * or `undefined` when the user cancels. Required because folder
   * pickers vary between desktop (Tauri dialog) and Android (SAF) and
   * the dialog itself shouldn't reach into platform code.
   */
  onPickDirectory: () => Promise<string | undefined>;
  onCancel: () => void;
  onConfirm: (result: ImportFromFolderResult) => void;
}

const DEFAULT_SELECTED_GROUP_IDS = ['epub', 'pdf'];
const DEFAULT_MIN_SIZE_KB = 20;

/**
 * Folder import dialog: lets the user pick a directory, choose which
 * book formats to include, and skip files below a size threshold. The
 * caller is responsible for the actual scan & import — we just collect
 * the user's intent and hand it back via {@link onConfirm}.
 *
 * Renders inside the project's shared `<Dialog>` primitive so it picks
 * up the standard chassis (modal-box, eink-aware borders, mobile bottom
 * sheet, RTL direction, focus management) instead of reimplementing
 * them locally.
 */
const ImportFromFolderDialog: React.FC<ImportFromFolderDialogProps> = ({
  initialDirectory,
  initialFolderMode = 'keep',
  initialSelectedGroupIds,
  initialMinSizeKB,
  initialReadInPlace = false,
  isRegisteredExternalRoot,
  onPickDirectory,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();

  const [directory, setDirectory] = useState(initialDirectory);
  // EPUB + PDF default to selected; this matches the screenshot the
  // feature was modelled on and reflects the two formats new users are
  // overwhelmingly most likely to have on disk. A persisted empty set
  // is treated as "use defaults" so the OK button isn't disabled on
  // dialog open.
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(() => {
    const valid = (initialSelectedGroupIds ?? []).filter((id) =>
      DEFAULT_FORMAT_GROUPS.some((g) => g.id === id),
    );
    return new Set(valid.length > 0 ? valid : DEFAULT_SELECTED_GROUP_IDS);
  });
  const [minSizeKB, setMinSizeKB] = useState<number>(
    Number.isFinite(initialMinSizeKB) && (initialMinSizeKB as number) >= 0
      ? (initialMinSizeKB as number)
      : DEFAULT_MIN_SIZE_KB,
  );
  // `keep` mirrors folders into nested groups (legacy behaviour);
  // `flatten` drops every book straight into the current library
  // root regardless of where it lived on disk. The caller seeds this
  // from localStorage so the user's last choice is restored.
  const [folderMode, setFolderMode] = useState<'keep' | 'flatten'>(initialFolderMode);
  // "Read in place" toggle. When the directory is already registered
  // as an external library folder we force this ON and hide the
  // toggle's interactive surface — see {@link readInPlaceLocked}
  // below — because imports from a registered folder are always
  // in-place by design (the importer's `shouldImportInPlace` check is
  // path-prefix based and ignores any per-import opt-out).
  const [readInPlace, setReadInPlace] = useState<boolean>(initialReadInPlace);
  const [picking, setPicking] = useState(false);

  const readInPlaceLocked = !!directory && (isRegisteredExternalRoot?.(directory) ?? false);
  const effectiveReadInPlace = readInPlaceLocked || readInPlace;

  // Enter to confirm, Escape / Android Back to cancel. We must wire
  // `onCancel` even though <Dialog> also listens for Back, because
  // `useKeyDownActions` registers its own `native-key-down` listener that
  // returns `true` (consuming the event) on every Back keypress — if we
  // leave `onCancel` undefined the handler swallows Back without doing
  // anything, and the Dialog's own listener never gets a chance to run.
  useKeyDownActions({
    onConfirm: () => {
      // Block the Enter shortcut while a folder pick is in flight so
      // we don't dispatch a confirm with a stale directory.
      if (picking) return;
      handleConfirm();
    },
    onCancel: () => {
      if (picking) return;
      onCancel();
    },
  });

  const toggleGroup = (id: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handlePickDirectory = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const picked = await onPickDirectory();
      if (picked) setDirectory(picked);
    } finally {
      setPicking(false);
    }
  };

  const handleConfirm = () => {
    if (!directory) return;
    const exts: string[] = [];
    const selectedIds: string[] = [];
    for (const g of DEFAULT_FORMAT_GROUPS) {
      if (selectedGroups.has(g.id)) {
        exts.push(...g.exts);
        selectedIds.push(g.id);
      }
    }
    if (exts.length === 0) return;
    const safeMinSizeKB = Math.max(0, Math.floor(minSizeKB));
    onConfirm({
      directory,
      extensions: exts,
      selectedGroupIds: selectedIds,
      minSizeKB: safeMinSizeKB,
      flatten: folderMode === 'flatten',
      readInPlace: effectiveReadInPlace,
    });
  };

  const confirmDisabled = !directory || selectedGroups.size === 0;

  return (
    <Dialog
      isOpen
      title={_('Import Books')}
      onClose={onCancel}
      boxClassName='sm:min-w-[480px] sm:max-w-[480px] sm:h-auto sm:max-h-[90%]'
      contentClassName='!px-6 !py-2'
    >
      <div className='flex flex-col gap-4 pt-2'>
        {/* Directory row — clickable input that pops the native folder
            picker. We render it as a real <button> so screen readers and
            keyboard navigation work, but style it as an input row so the
            visual matches the original screenshot's design. */}
        <div className='flex flex-col gap-1.5'>
          <span className='text-base-content/70 text-xs'>{_('Folder')}</span>
          <button
            type='button'
            onClick={handlePickDirectory}
            disabled={picking}
            className={clsx(
              'eink-bordered flex w-full items-center gap-2 rounded-lg px-3 py-2.5',
              'text-start text-sm transition-colors duration-150',
              'border-base-300 bg-base-200/40 hover:bg-base-200/70',
              'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
              picking && 'opacity-60',
            )}
            title={directory || _('Choose a folder')}
            aria-label={_('Choose a folder')}
          >
            <MdFolderOpen className='text-base-content/70 h-5 w-5 flex-shrink-0' />
            <span className={clsx('min-w-0 flex-1 truncate', !directory && 'text-base-content/50')}>
              {directory || _('Choose a folder')}
            </span>
          </button>
        </div>

        {/* Format checkboxes — laid out as a 2-column grid so 6 entries
            fit in three rows on phones without horizontal scrolling. */}
        <div className='flex flex-col gap-1.5'>
          <span className='text-base-content/70 text-xs'>{_('File Formats')}</span>
          <div className='grid grid-cols-2 gap-x-3 gap-y-2'>
            {DEFAULT_FORMAT_GROUPS.map((group) => {
              const checked = selectedGroups.has(group.id);
              return (
                <label
                  key={group.id}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2',
                    'rounded-md px-1 py-1 text-sm',
                    'hover:bg-base-200/50',
                  )}
                >
                  <input
                    type='checkbox'
                    className='checkbox checkbox-sm'
                    checked={checked}
                    onChange={() => toggleGroup(group.id)}
                  />
                  <span className='select-none'>{group.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Min-size filter — number input with the KB suffix nested
            inside the field so it reads as a single unit. The native
            number-spinner arrows are hidden because they overlapped
            the rounded input border and looked broken on macOS / WebKit. */}
        <div className='flex items-center justify-between gap-3'>
          <span className='text-sm'>{_('File size larger than')}</span>
          <div
            className={clsx(
              'eink-bordered flex items-center',
              'border-base-300 bg-base-200/40',
              'h-9 w-24 rounded-lg',
              'focus-within:ring-primary/40 focus-within:ring-2',
            )}
          >
            <input
              type='number'
              inputMode='numeric'
              min={0}
              step={1}
              value={Number.isFinite(minSizeKB) ? minSizeKB : 0}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setMinSizeKB(Number.isFinite(v) && v >= 0 ? v : 0);
              }}
              className={clsx(
                'no-spinner',
                'h-full min-w-0 flex-1 rounded-s-lg bg-transparent',
                'ps-2 pe-1 text-end text-sm',
                'focus:outline-none',
              )}
              aria-label={_('Minimum file size (KB)')}
            />
            <span className='text-base-content/70 select-none pe-2 text-xs'>{_('KB')}</span>
          </div>
        </div>

        {/* Read-in-place toggle. When OFF (default), each book is
            copied into Books/<hash>/ as before. When ON, the chosen
            folder is registered in `settings.externalLibraryFolders`
            and the importer keeps each book at its original path —
            no copy. See `runFolderImport` and `shouldImportInPlace`
            in ingestService for the downstream effects (cloud sync,
            symmetric local delete). */}
        <div className='flex flex-col gap-1.5'>
          <label
            className={clsx(
              'flex items-start gap-2 rounded-md px-1 py-1 text-sm',
              readInPlaceLocked ? 'cursor-default' : 'cursor-pointer hover:bg-base-200/50',
            )}
          >
            <input
              type='checkbox'
              className='checkbox checkbox-sm mt-0.5'
              checked={effectiveReadInPlace}
              disabled={readInPlaceLocked}
              onChange={(e) => setReadInPlace(e.target.checked)}
            />
            <span className='select-none'>
              <span className='block'>{_('Read books in place')}</span>
              <span className='text-base-content/60 block text-xs'>
                {readInPlaceLocked
                  ? _('This folder is an external library. Books here are always read in place.')
                  : _(
                      'Read books from their original folders instead of copying them into the library. Saves disk space; cloud auto-upload still works if enabled.',
                    )}
              </span>
            </span>
          </label>
        </div>

        {/* Folder-structure mode — radios let the user choose between
            mirroring subfolders as nested library groups (legacy) or
            flattening everything straight into the library. */}
        <div className='flex flex-col gap-1.5' role='radiogroup' aria-label={_('Folder Structure')}>
          <span className='text-base-content/70 text-xs'>{_('Folder Structure')}</span>
          <label
            className={clsx(
              'flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm',
              'hover:bg-base-200/50',
            )}
          >
            <input
              type='radio'
              name='import-folder-mode'
              className='radio radio-sm mt-0.5'
              checked={folderMode === 'keep'}
              onChange={() => setFolderMode('keep')}
            />
            <span className='select-none'>
              <span className='block'>{_('Create groups from subfolders')}</span>
              <span className='text-base-content/60 block text-xs'>
                {_('Each first-level subfolder becomes a library group.')}
              </span>
            </span>
          </label>
          <label
            className={clsx(
              'flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm',
              'hover:bg-base-200/50',
            )}
          >
            <input
              type='radio'
              name='import-folder-mode'
              className='radio radio-sm mt-0.5'
              checked={folderMode === 'flatten'}
              onChange={() => setFolderMode('flatten')}
            />
            <span className='select-none'>
              <span className='block'>{_('Import all into library')}</span>
              <span className='text-base-content/60 block text-xs'>
                {_('Recursively add every matching file directly to the library.')}
              </span>
            </span>
          </label>
        </div>

        <div className='mt-1 flex justify-end gap-2 pb-2'>
          <button type='button' className='btn btn-ghost btn-sm' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button
            type='button'
            className={clsx('btn btn-primary btn-sm', confirmDisabled && 'btn-disabled')}
            disabled={confirmDisabled}
            onClick={handleConfirm}
          >
            {_('OK')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default ImportFromFolderDialog;
