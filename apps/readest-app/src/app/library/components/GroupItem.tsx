import clsx from 'clsx';
import { MdCheckCircle, MdCheckCircleOutline } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { BooksGroup } from '@/types/book';
import BookCover from './BookCover';

interface GroupItemProps {
  group: BooksGroup;
  isSelectMode: boolean;
  selectedBooks: string[];
}

const GroupItem: React.FC<GroupItemProps> = ({ group, isSelectMode, selectedBooks }) => {
  const { appService } = useEnv();
  return (
    <div
      className={clsx(
        'group-item flex h-full flex-col',
        appService?.hasContextMenu ? 'cursor-pointer' : '',
      )}
    >
      <div className='bg-base-100 relative flex aspect-[28/41] items-center justify-center overflow-hidden p-2 shadow-md'>
        <div className='grid w-full grid-cols-2 grid-rows-2 gap-1 overflow-hidden'>
          {group.books.slice(0, 4).map((book) => (
            <div key={book.hash} className='relative aspect-[28/41] h-full w-full'>
              <BookCover book={book} isPreview />
            </div>
          ))}
        </div>
        {selectedBooks.includes(group.id) && (
          <div className='absolute inset-0 bg-black opacity-30 transition-opacity duration-300'></div>
        )}
        {isSelectMode && (
          <div className='absolute bottom-1 right-1'>
            {selectedBooks.includes(group.id) ? (
              <MdCheckCircle className='fill-blue-500' />
            ) : (
              <MdCheckCircleOutline className='fill-gray-300 drop-shadow-sm' />
            )}
          </div>
        )}
      </div>
      <div className='min-w-0 flex-1 pt-2'>
        <h4 className='block overflow-hidden text-ellipsis whitespace-nowrap text-xs font-semibold'>
          {group.name}
        </h4>
      </div>
    </div>
  );
};

export default GroupItem;
