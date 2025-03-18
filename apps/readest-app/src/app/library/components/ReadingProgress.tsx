import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';

interface ReadingProgressProps {
  book: Book;
}

const getProgressPercentage = (book: Book) => {
  if (!book.progress || !book.progress[1]) {
    return null;
  }
  if (book.progress && book.progress[1] === 1) {
    return 100;
  }
  const percentage = Math.round((book.progress[0] / book.progress[1]) * 100);
  return Math.max(0, Math.min(100, percentage));
};

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book }) => {
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);

    if (progressPercentage === null) {
      return null;
    }

    return (
      <div className='text-neutral-content/70 flex justify-between text-xs'>
        <span>{progressPercentage}%</span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
