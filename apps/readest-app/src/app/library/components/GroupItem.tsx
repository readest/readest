import Image from 'next/image';
import { BooksGroup } from '@/types/book';
import { formatAuthors, formatTitle } from '@/utils/book';
import ReadingProgress from './ReadingProgress';

interface GroupItemProps {
  group: BooksGroup;
}

const GroupItem: React.FC<GroupItemProps> = ({ group }) => {
  return (
    <div>
      {group.books.map((book) => (
        <div key={book.hash} className='card bg-base-100 w-full shadow-md'>
          <figure>
            <Image
              width={10}
              height={10}
              src={book.coverImageUrl!}
              alt={book.title || ''}
              className='h-48 w-full object-cover'
            />
          </figure>
          <div className='card-body p-4'>
            <h3 className='card-title line-clamp-2 text-sm'>{formatTitle(book.title)}</h3>
            <p className='text-neutral-content line-clamp-1 text-xs'>
              {formatAuthors(book.author)}
            </p>
            <ReadingProgress book={book} />
          </div>
        </div>
      ))}
      <h2 className='mb-2 text-lg font-bold'>{group.name}</h2>
    </div>
  );
};

export default GroupItem;
