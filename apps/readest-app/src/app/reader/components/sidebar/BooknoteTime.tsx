import dayjs from 'dayjs';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const BooknoteTimeContext = createContext(0);

export const BooknoteTimeProvider = ({ children }: { children: ReactNode }) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  return <BooknoteTimeContext.Provider value={tick}>{children}</BooknoteTimeContext.Provider>;
};

export const BooknoteTimeLabel = ({ createdAt }: { createdAt: number }) => {
  // Subscribe only the label, so clock ticks don't re-render the list or cards.
  useContext(BooknoteTimeContext);

  // Read the actual clock, including for rows mounted between ticks.
  return (
    <span
      className='truncate text-sm text-gray-500 sm:text-xs'
      title={dayjs(createdAt).format('YYYY-MM-DD HH:mm:ss')}
    >
      {dayjs(createdAt).fromNow()}
    </span>
  );
};
