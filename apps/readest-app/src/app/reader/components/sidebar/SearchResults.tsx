import React, { useMemo } from 'react';
import { BookSearchMatch, BookSearchResult, SearchExcerpt } from '@/types/book';
import { useReaderStore } from '@/store/readerStore';
import { findNearestCfi } from '@/utils/cfi';
import useScrollToItem from '../../hooks/useScrollToItem';
import clsx from 'clsx';

interface SearchResultItemProps {
  bookKey: string;
  cfi: string;
  excerpt: SearchExcerpt;
  isNearest?: boolean;
  onSelectResult: (cfi: string) => void;
}

const SearchResultItem: React.FC<SearchResultItemProps> = ({
  bookKey,
  cfi,
  excerpt,
  isNearest,
  onSelectResult,
}) => {
  const { getProgress } = useReaderStore();
  const progress = getProgress(bookKey)!;
  const { isCurrent, viewRef } = useScrollToItem(cfi, progress, isNearest);

  return (
    <li
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
      role='button'
      ref={viewRef}
      className={clsx(
        'my-2 cursor-pointer rounded-lg p-2 text-sm',
        isCurrent ? 'bg-base-300 hover:bg-gray-300/70' : 'hover:bg-base-300 bg-base-100',
      )}
      tabIndex={0}
      onClick={() => onSelectResult(cfi)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelectResult(cfi);
        } else {
          e.stopPropagation();
        }
      }}
    >
      <div className='line-clamp-3'>
        <span className=''>{excerpt.pre}</span>
        <span className='font-bold text-red-500'>{excerpt.match}</span>
        <span className=''>{excerpt.post}</span>
      </div>
    </li>
  );
};
interface SearchResultsProps {
  bookKey: string;
  results: BookSearchResult[] | BookSearchMatch[];
  onSelectResult: (cfi: string) => void;
}

const SearchResults: React.FC<SearchResultsProps> = ({ bookKey, results, onSelectResult }) => {
  const { getProgress } = useReaderStore();
  const progress = getProgress(bookKey);

  const nearestCfi = useMemo(() => {
    const allCfis: string[] = [];
    for (const result of results) {
      if ('subitems' in result) {
        for (const item of result.subitems) allCfis.push(item.cfi);
      } else {
        allCfis.push(result.cfi);
      }
    }
    return findNearestCfi(allCfis, progress?.location);
  }, [progress?.location, results]);

  return (
    <div className='search-results overflow-y-auto p-2 font-sans text-sm font-light'>
      <ul className='px-2'>
        {results.map((result, index) => {
          if ('subitems' in result) {
            return (
              <ul key={`${index}-${result.label}`}>
                <h3 className='line-clamp-1 font-normal'>{result.label}</h3>
                <ul>
                  {result.subitems.map((item, index) => (
                    <SearchResultItem
                      key={`${index}-${item.cfi}`}
                      bookKey={bookKey}
                      cfi={item.cfi}
                      excerpt={item.excerpt}
                      isNearest={item.cfi === nearestCfi}
                      onSelectResult={onSelectResult}
                    />
                  ))}
                </ul>
              </ul>
            );
          } else {
            return (
              <SearchResultItem
                key={`${index}-${result.cfi}`}
                bookKey={bookKey}
                cfi={result.cfi}
                excerpt={result.excerpt}
                isNearest={result.cfi === nearestCfi}
                onSelectResult={onSelectResult}
              />
            );
          }
        })}
      </ul>
    </div>
  );
};

export default SearchResults;
