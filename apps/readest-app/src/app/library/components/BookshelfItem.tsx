import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { navigateToLibrary, navigateToReader } from '@/utils/nav';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useLongPress } from '@/hooks/useLongPress';
import { Menu, MenuItem } from '@tauri-apps/api/menu';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { getOSPlatform } from '@/utils/misc';
import { getFilename } from '@/utils/book';
import { BOOK_UNGROUPED_ID, BOOK_UNGROUPED_NAME } from '@/services/constants';
import { FILE_REVEAL_LABELS, FILE_REVEAL_PLATFORMS } from '@/utils/os';
import { Book, BookGroupType, BooksGroup } from '@/types/book';
import BookItem from './BookItem';
import GroupItem from './GroupItem';

export type BookshelfItem = Book | BooksGroup;

export const generateBookshelfItems = (books: Book[]): (Book | BooksGroup)[] => {
  const groups: BooksGroup[] = books.reduce((acc: BooksGroup[], book: Book) => {
    if (book.deletedAt) return acc;
    book.groupId = book.groupId || BOOK_UNGROUPED_ID;
    book.groupName = book.groupName || BOOK_UNGROUPED_NAME;
    const groupIndex = acc.findIndex((group) => group.id === book.groupId);
    const booksGroup = acc[acc.findIndex((group) => group.id === book.groupId)];
    if (booksGroup) {
      booksGroup.books.push(book);
      booksGroup.updatedAt = Math.max(acc[groupIndex]!.updatedAt, book.updatedAt);
    } else {
      acc.push({
        id: book.groupId,
        name: book.groupName,
        books: [book],
        updatedAt: book.updatedAt,
      });
    }
    return acc;
  }, []);
  groups.forEach((group) => {
    group.books.sort((a, b) => b.updatedAt - a.updatedAt);
  });
  const ungroupedBooks: Book[] =
    groups.find((group) => group.name === BOOK_UNGROUPED_NAME)?.books || [];
  const groupedBooks: BooksGroup[] = groups.filter((group) => group.name !== BOOK_UNGROUPED_NAME);
  return [...ungroupedBooks, ...groupedBooks].sort((a, b) => b.updatedAt - a.updatedAt);
};

export const generateGroupsList = (items: Book[]): BookGroupType[] => {
  return items
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .reduce((acc: BookGroupType[], item: Book) => {
      if (item.deletedAt) return acc;
      if (
        item.groupId &&
        item.groupName &&
        item.groupId !== BOOK_UNGROUPED_ID &&
        item.groupName !== BOOK_UNGROUPED_NAME &&
        !acc.find((group) => group.id === item.groupId)
      ) {
        acc.push({ id: item.groupId, name: item.groupName });
      }
      return acc;
    }, []) as BookGroupType[];
};

interface BookshelfItemProps {
  item: BookshelfItem;
  isSelectMode: boolean;
  selectedBooks: string[];
  transferProgress: number | null;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSelection: (hash: string) => void;
  handleBookUpload: (book: Book) => void;
  handleBookDownload: (book: Book) => void;
  handleBookDelete: (book: Book) => void;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
}

const BookshelfItem: React.FC<BookshelfItemProps> = ({
  item,
  isSelectMode,
  selectedBooks,
  transferProgress,
  setLoading,
  toggleSelection,
  handleBookUpload,
  handleBookDownload,
  handleBookDelete,
  handleSetSelectMode,
  handleShowDetailsBook,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateBook } = useLibraryStore();

  const showBookDetailsModal = async (book: Book) => {
    if (await makeBookAvailable(book)) {
      handleShowDetailsBook(book);
    }
  };

  const makeBookAvailable = async (book: Book) => {
    if (book.uploadedAt && !book.downloadedAt) {
      let available = false;
      try {
        await handleBookDownload(book);
        updateBook(envConfig, book);
        available = true;
      } finally {
        return available;
      }
    }
    return true;
  };

  const handleBookClick = async (book: Book) => {
    if (!(await makeBookAvailable(book))) return;

    if (isSelectMode) {
      toggleSelection(book.hash);
    } else {
      setTimeout(() => setLoading(true), 200);
      navigateToReader(router, [book.hash]);
    }
  };

  const handleGroupClick = (group: BooksGroup) => {
    if (isSelectMode) {
      toggleSelection(group.id);
    } else {
      navigateToLibrary(router, `group=${group.id}`);
    }
  };

  const handleItemContextMenu = (item: BookshelfItem, event: React.MouseEvent) => {
    event.preventDefault();
    if ('format' in item) {
      bookContextMenuHandler(item as Book, event);
    }
  };

  const bookContextMenuHandler = async (book: Book, e: React.MouseEvent) => {
    if (!appService?.hasContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const osPlatform = getOSPlatform();
    const fileRevealLabel =
      FILE_REVEAL_LABELS[osPlatform as FILE_REVEAL_PLATFORMS] || FILE_REVEAL_LABELS.default;
    const openBookMenuItem = await MenuItem.new({
      text: isSelectMode ? _('Select Book') : _('Open Book'),
      action: async () => {
        handleBookClick(book);
      },
    });
    const showBookInFinderMenuItem = await MenuItem.new({
      text: _(fileRevealLabel),
      action: async () => {
        const folder = `${settings.localBooksDir}/${getFilename(book)}`;
        revealItemInDir(folder);
      },
    });
    const showBookDetailsMenuItem = await MenuItem.new({
      text: _('Show Book Details'),
      action: async () => {
        showBookDetailsModal(book);
      },
    });
    const uploadBookMenuItem = await MenuItem.new({
      text: _('Upload Book'),
      action: async () => {
        handleBookUpload(book);
      },
    });
    const deleteBookMenuItem = await MenuItem.new({
      text: _('Delete'),
      action: async () => {
        await handleBookDelete(book);
      },
    });
    const menu = await Menu.new();
    menu.append(openBookMenuItem);
    menu.append(showBookDetailsMenuItem);
    menu.append(showBookInFinderMenuItem);
    menu.append(uploadBookMenuItem);
    menu.append(deleteBookMenuItem);
    menu.popup();
  };

  const { pressing, handlers } = useLongPress({
    onLongPress: () => {
      if (!isSelectMode) {
        handleSetSelectMode(true);
      }
      if ('format' in item) {
        toggleSelection((item as Book).hash);
      } else {
        toggleSelection((item as BooksGroup).id);
      }
    },
    onTap: () => {
      if ('format' in item) {
        handleBookClick(item as Book);
      } else {
        handleGroupClick(item as BooksGroup);
      }
    },
  });

  return (
    <div
      className={clsx(
        'hover:bg-base-300/50 group flex h-full flex-col p-4',
        pressing ? 'scale-95' : 'scale-100',
      )}
      style={{
        transition: 'transform 0.2s',
      }}
      {...handlers}
      onContextMenu={(event) => handleItemContextMenu(item, event)}
    >
      <div className='flex-grow'>
        {'format' in item ? (
          <BookItem
            book={item}
            isSelectMode={isSelectMode}
            selectedBooks={selectedBooks}
            handleBookUpload={handleBookUpload}
            handleBookDownload={handleBookDownload}
            showBookDetailsModal={showBookDetailsModal}
            bookContextMenuHandler={bookContextMenuHandler}
            transferProgress={transferProgress}
          />
        ) : (
          <GroupItem group={item} isSelectMode={isSelectMode} selectedBooks={selectedBooks} />
        )}
      </div>
    </div>
  );
};

export default BookshelfItem;
