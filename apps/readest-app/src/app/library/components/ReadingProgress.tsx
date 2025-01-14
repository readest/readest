import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book, BookConfig } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';

interface ReadingProgressProps {
  book: Book;
}

const getProgressPercentage = (config: BookConfig | null) => {
  if (!config?.progress || !config.progress[1]) return 0;
  return Math.round((config.progress[0] / config.progress[1]) * 100);
};

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book }) => {
    const config = useBookDataStore((state) => state.getConfig(book.hash));

    const progressPercentage = useMemo(() => getProgressPercentage(config), [config]);

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
