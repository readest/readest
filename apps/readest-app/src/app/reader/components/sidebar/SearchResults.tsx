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
        'group relative my-2 cursor-pointer rounded-[18px] px-3 py-3 text-sm transition-colors duration-150',
        isCurrent
          ? 'border-[#b48c49]/42 border bg-[linear-gradient(90deg,rgba(61,21,16,0.94),rgba(31,14,11,0.92)_68%,rgba(18,11,9,0.74))] text-[#f0d6a0] shadow-[inset_0_1px_0_rgba(255,237,193,0.08),0_0_18px_rgba(132,26,18,0.16)]'
          : 'border-[#5e4525]/18 hover:border-[#8f6a37]/34 border bg-[linear-gradient(180deg,rgba(24,16,13,0.86),rgba(12,9,8,0.94))] text-[#dbc7a0] hover:bg-[#251612]',
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
      <span
        aria-hidden='true'
        className={clsx(
          'absolute bottom-2 left-0 top-2 w-[2px] rounded-full bg-gradient-to-b from-[#b73a2f] to-[#c9a45a] transition-opacity duration-150',
          isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-70',
        )}
      />
      <div className='line-clamp-3'>
        <span className=''>{excerpt.pre}</span>
        <span className='bg-[#5a3518]/52 rounded-[3px] px-[2px] py-[1px] font-semibold text-[#e6bf77]'>
          {excerpt.match}
        </span>
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
    <div className='search-results overflow-y-auto rounded-[24px] border border-[#c9a45a]/30 bg-[linear-gradient(180deg,rgba(18,12,10,0.97),rgba(11,8,7,0.97))] p-4 font-sans text-sm font-light text-[#dcc8a1] shadow-[0_18px_40px_rgba(0,0,0,0.34),0_0_22px_rgba(126,31,25,0.18)] sm:absolute sm:bottom-[20px] sm:left-[calc(100%+22px)] sm:top-[86px] sm:z-[4] sm:w-[344px]'>
      <ul className='px-1'>
        {results.map((result, index) => {
          if ('subitems' in result) {
            return (
              <ul key={`${index}-${result.label}`} className='mb-3 last:mb-0'>
                <h3 className='border-[#5e4525]/24 mb-2 border-b pb-1.5 font-serif text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c9ab73]'>
                  {result.label}
                </h3>
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
