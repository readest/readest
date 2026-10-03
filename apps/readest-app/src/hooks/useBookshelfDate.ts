import { useEffect, useState } from 'react';
import type { BookshelfDefinition, BookshelfFilterGroup } from '@/types/bookshelf';

const hasRelativeDate = (group: BookshelfFilterGroup): boolean =>
  group.children.some((node) =>
    node.type === 'group' ? hasRelativeDate(node) : node.operator === 'withinLast',
  );

/** Date filters use UTC calendar days; invalidate their matches when that day changes. */
export const useBookshelfDate = (definitions: BookshelfDefinition[]) => {
  const [today, setToday] = useState(() => Math.floor(Date.now() / 86400000) * 86400000);
  const active = definitions.some((shelf) => hasRelativeDate(shelf.filters));
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      const day = Math.floor(now / 86400000) * 86400000;
      setToday(day);
      timer = setTimeout(refresh, day + 86400000 - now);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [active]);
  return today;
};
