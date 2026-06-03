import clsx from 'clsx';
import { useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLongPress } from '@/hooks/useLongPress';
import { Menu, type MenuItemOptions } from '@tauri-apps/api/menu';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { eventDispatcher } from '@/utils/event';
import { getOSPlatform } from '@/utils/misc';
import { throttle } from '@/utils/throttle';
import { navigateToReader, showReaderWindow } from '@/utils/nav';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { FILE_REVEAL_LABELS, FILE_REVEAL_PLATFORMS } from '@/utils/os';
import { Book, BooksGroup, ReadingStatus } from '@/types/book';
import {
  getBookContextMenuItemIds,
  type BookContextMenuItemId,
} from '@/app/library/utils/libraryUtils';
import { md5Fingerprint } from '@/utils/md5';
import BookItem from './BookItem';
import GroupItem from './GroupItem';

export const generateBookshelfItems = (
  books: Book[],
  parentGroupName: string,
): (Book | BooksGroup)[] => {
  const groupsMap = new Map<string, BooksGroup>();

  for (const book of books) {
    if (book.deletedAt) continue;

    const groupName = book.groupName || BOOK_UNGROUPED_NAME;
    if (
      parentGroupName &&
      groupName !== parentGroupName &&
      !groupName.startsWith(parentGroupName + '/')
    ) {
      continue;
    }

    const relativePath = parentGroupName ? groupName.slice(parentGroupName.length + 1) : groupName;
    // Get the immediate child group name (or empty if book is directly in parent)
    const slashIndex = relativePath.indexOf('/');
    const immediateChild = slashIndex > 0 ? relativePath.slice(0, slashIndex) : relativePath;
    // Determine if this book belongs directly to the parent group
    const isDirectChild =
      groupName === parentGroupName || (groupName === BOOK_UNGROUPED_NAME && !parentGroupName);
    // Build the full group name for this level
    const fullGroupName = isDirectChild
      ? BOOK_UNGROUPED_NAME
      : parentGroupName
        ? `${parentGroupName}/${immediateChild}`
        : immediateChild;

    const mapKey = fullGroupName;
    const existingGroup = groupsMap.get(mapKey);
    if (existingGroup) {
      existingGroup.books.push(book);
      existingGroup.updatedAt = Math.max(existingGroup.updatedAt, book.updatedAt);
    } else {
      groupsMap.set(mapKey, {
        id: isDirectChild ? BOOK_UNGROUPED_ID : md5Fingerprint(fullGroupName),
        name: fullGroupName,
        displayName: isDirectChild ? BOOK_UNGROUPED_NAME : immediateChild,
        books: [book],
        updatedAt: book.updatedAt,
      });
    }
  }

  for (const group of groupsMap.values()) {
    group.books.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const ungroupedGroup = groupsMap.get(BOOK_UNGROUPED_NAME);
  const ungroupedBooks = ungroupedGroup?.books || [];
  const groupedBooks = Array.from(groupsMap.values()).filter(
    (group) => group.name !== BOOK_UNGROUPED_NAME,
  );

  return [...ungroupedBooks, ...groupedBooks].sort((a, b) => b.updatedAt - a.updatedAt);
};

interface BookshelfItemProps {
  mode: LibraryViewModeType;
  item: Book | BooksGroup;
  coverFit: LibraryCoverFitType;
  isSelectMode: boolean;
  itemSelected: boolean;
  transferProgress: number | null;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSelection: (hash: string) => void;
  handleGroupBooks: () => void;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => Promise<boolean>;
  handleBookUpload: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleBookDelete: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
  handleLibraryNavigation: (targetGroup: string) => void;
  handleUpdateReadingStatus: (book: Book, status: ReadingStatus | undefined) => void;
}

const BookshelfItem: React.FC<BookshelfItemProps> = ({
  mode,
  item,
  coverFit,
  isSelectMode,
  itemSelected,
  transferProgress,
  setLoading,
  toggleSelection,
  handleGroupBooks,
  handleBookUpload,
  handleBookDownload,
  handleSetSelectMode,
  handleShowDetailsBook,
  handleLibraryNavigation,
  handleUpdateReadingStatus,
}) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateBook } = useLibraryStore();

  const showBookDetailsModal = useCallback(async (book: Book) => {
    handleShowDetailsBook(book);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const makeBookAvailable = async (book: Book) => {
    if (book.uploadedAt && !book.downloadedAt) {
      if (await appService?.isBookAvailable(book)) {
        if (!book.downloadedAt || !book.coverDownloadedAt) {
          book.downloadedAt = Date.now();
          book.coverDownloadedAt = Date.now();
          await updateBook(envConfig, book);
        }
        return true;
      }
      let available = false;
      const loadingTimeout = setTimeout(() => setLoading(true), 200);
      try {
        available = await handleBookDownload(book, { queued: false });
        await updateBook(envConfig, book);
      } finally {
        if (loadingTimeout) clearTimeout(loadingTimeout);
        setLoading(false);
      }
      return available;
    }
    return true;
  };

  const handleBookClick = useCallback(
    async (book: Book) => {
      if (isSelectMode) {
        toggleSelection(book.hash);
        return;
      }
      // In-place books point at a file outside Books/<hash>/ that the user
      // (or another app) may have moved, renamed, or deleted between sessions.
      // Probe the source before navigating: if it's gone, drop the stale
      // library record instead of opening the reader only to fail inside
      // loadBookContent and bounce back with a toast. We restrict this to
      // purely-local in-place books — cloud-synced books (`uploadedAt`) still
      // go through `makeBookAvailable`'s on-demand download path below, and
      // hash-copy books (no `filePath`) shouldn't lose their Books/<hash>/
      // file under normal use, so we don't second-guess those here.
      if (book.filePath && !book.uploadedAt && !book.deletedAt) {
        const available = await appService?.isBookAvailable(book);
        if (!available) {
          eventDispatcher.dispatch('toast', {
            message: _(
              'Book file no longer exists. Confirm deletion to remove it from the library.',
            ),
            type: 'info',
          });
          eventDispatcher.dispatch('delete-books', { ids: [book.hash] });
          return;
        }
      }
      const available = await makeBookAvailable(book);
      if (!available) return;
      if (appService?.hasWindow && settings.openBookInNewWindow) {
        showReaderWindow(appService, [book.hash]);
      } else {
        setTimeout(() => {
          navigateToReader(router, [book.hash]);
        }, 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSelectMode, settings.openBookInNewWindow, appService],
  );

  const handleGroupClick = useCallback(
    (group: BooksGroup) => {
      if (isSelectMode) {
        toggleSelection(group.id);
      } else {
        handleLibraryNavigation(group.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSelectMode, handleLibraryNavigation],
  );

  const bookContextMenuHandler = async (book: Book) => {
    if (!appService?.hasContextMenu) return;
    const osPlatform = getOSPlatform();
    const fileRevealLabel =
      FILE_REVEAL_LABELS[osPlatform as FILE_REVEAL_PLATFORMS] || FILE_REVEAL_LABELS.default;
    // Build every item up front, then create the menu from the ordered subset
    // in a single Menu.new({ items }) call. Appending items one-by-one with
    // un-awaited Menu.append() promises races on the Tauri IPC boundary and
    // shuffles the order on every open (issue #4389).
    const itemOptions: Record<BookContextMenuItemId, MenuItemOptions> = {
      select: {
        text: itemSelected ? _('Deselect Book') : _('Select Book'),
        action: async () => {
          if (!isSelectMode) handleSetSelectMode(true);
          toggleSelection(book.hash);
        },
      },
      group: {
        text: _('Group Books'),
        action: async () => {
          if (!isSelectMode) handleSetSelectMode(true);
          if (!itemSelected) {
            toggleSelection(book.hash);
          }
          handleGroupBooks();
        },
      },
      markFinished: {
        text: _('Mark as Finished'),
        action: async () => {
          handleUpdateReadingStatus(book, 'finished');
        },
      },
      markUnread: {
        text: _('Mark as Unread'),
        action: async () => {
          handleUpdateReadingStatus(book, 'unread');
        },
      },
      clearStatus: {
        text: _('Clear Status'),
        action: async () => {
          handleUpdateReadingStatus(book, undefined);
        },
      },
      showDetails: {
        text: _('Show Book Details'),
        action: async () => {
          showBookDetailsModal(book);
        },
      },
      showInFinder: {
        text: _(fileRevealLabel),
        action: async () => {
          const folder = `${settings.localBooksDir}/${book.hash}`;
          revealItemInDir(folder);
        },
      },
      download: {
        text: _('Download Book'),
        action: async () => {
          handleBookDownload(book, { queued: true });
        },
      },
      upload: {
        text: _('Upload Book'),
        action: async () => {
          handleBookUpload(book);
        },
      },
      share: {
        text: _('Share Book'),
        action: async () => {
          // Bookshelf.tsx hosts the dialog; we dispatch and let it route
          // unauthenticated users into the login flow first.
          eventDispatcher.dispatch('show-share-dialog', { book });
        },
      },
      delete: {
        text: _('Delete'),
        action: async () => {
          eventDispatcher.dispatch('delete-books', { ids: [book.hash] });
        },
      },
    };
    const items = getBookContextMenuItemIds(book).map((id) => itemOptions[id]);
    const menu = await Menu.new({ items });
    await menu.popup();
  };

  const groupContextMenuHandler = async (group: BooksGroup) => {
    if (!appService?.hasContextMenu) return;
    // Single Menu.new({ items }) call keeps the order deterministic — see the
    // note in bookContextMenuHandler about the Menu.append() IPC race (#4389).
    const items: MenuItemOptions[] = [
      {
        text: itemSelected ? _('Deselect Group') : _('Select Group'),
        action: async () => {
          if (!isSelectMode) handleSetSelectMode(true);
          toggleSelection(group.id);
        },
      },
      {
        text: _('Group Books'),
        action: async () => {
          if (!isSelectMode) handleSetSelectMode(true);
          if (!itemSelected) {
            toggleSelection(group.id);
          }
          handleGroupBooks();
        },
      },
      {
        text: _('Delete'),
        action: async () => {
          // Dispatch the constituent book hashes — `group.books` is the
          // rendered rollup and already includes books from nested sub-
          // folders, so the deletion path doesn't need to re-derive what
          // belongs to the group from the id alone.
          const ids = group.books.filter((book) => !book.deletedAt).map((book) => book.hash);
          eventDispatcher.dispatch('delete-books', { ids });
        },
      },
    ];
    const menu = await Menu.new({ items });
    await menu.popup();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSelectItem = useCallback(
    throttle(() => {
      if (!isSelectMode) {
        handleSetSelectMode(true);
      }
      if ('format' in item) {
        toggleSelection((item as Book).hash);
      } else {
        toggleSelection((item as BooksGroup).id);
      }
    }, 100),
    [isSelectMode],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleOpenItem = useCallback(
    throttle(() => {
      if (isSelectMode) {
        handleSelectItem();
        return;
      }
      if ('format' in item) {
        handleBookClick(item as Book);
      } else {
        handleGroupClick(item as BooksGroup);
      }
    }, 100),
    [handleSelectItem, handleBookClick, handleGroupClick],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleContextMenu = useCallback(
    throttle(() => {
      if ('format' in item) {
        bookContextMenuHandler(item as Book);
      } else {
        groupContextMenuHandler(item as BooksGroup);
      }
    }, 100),
    [itemSelected, settings.localBooksDir],
  );

  const { pressing, handlers } = useLongPress(
    {
      onLongPress: () => {
        handleSelectItem();
      },
      onTap: () => {
        handleOpenItem();
      },
      onContextMenu: () => {
        if (appService?.hasContextMenu) {
          handleContextMenu();
        } else if (appService?.isAndroidApp) {
          handleSelectItem();
        }
      },
    },
    [isSelectMode, handleSelectItem, handleOpenItem, handleContextMenu],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenItem();
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      handleContextMenu();
    }
  };

  // Tag the rendered DOM with the book/group identity so feature code
  // (e.g. the Send action's macOS share-popover anchor) can locate the
  // exact bookshelf cell the user is acting on without threading refs
  // through every parent. Books carry their content-hash; groups carry
  // their full group name.
  const itemDataAttrs =
    'format' in item ? { 'data-book-hash': item.hash } : { 'data-group-name': item.name };

  return (
    <div className={clsx(mode === 'grid' ? 'h-full' : 'sm:hover:bg-base-300/50 px-4 sm:px-6')}>
      <div
        className={clsx(
          'visible-focus-inset-2 group',
          mode === 'grid' &&
            'sm:hover:bg-base-300/50 flex h-full flex-col px-0 py-2 sm:rounded-md sm:px-4 sm:py-4',
          mode === 'list' && 'border-base-300 flex flex-col border-b py-2',
          appService?.isMobileApp && 'no-context-menu',
          pressing && mode === 'grid' ? 'not-eink:scale-95' : 'scale-100',
        )}
        role='button'
        tabIndex={0}
        aria-label={'format' in item ? item.title : item.name}
        style={{
          transition: 'transform 0.2s',
        }}
        onKeyDown={handleKeyDown}
        {...itemDataAttrs}
        {...handlers}
      >
        <div className='flex h-full flex-col justify-end'>
          {'format' in item ? (
            <BookItem
              mode={mode}
              book={item}
              coverFit={coverFit}
              isSelectMode={isSelectMode}
              bookSelected={itemSelected}
              transferProgress={transferProgress}
              handleBookUpload={handleBookUpload}
              handleBookDownload={handleBookDownload}
              showBookDetailsModal={showBookDetailsModal}
            />
          ) : (
            <GroupItem
              mode={mode}
              group={item}
              isSelectMode={isSelectMode}
              groupSelected={itemSelected}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default BookshelfItem;
