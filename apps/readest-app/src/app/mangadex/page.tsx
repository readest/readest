'use client';

import { Toast } from '@/components/Toast';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import clsx from 'clsx';
import { Navigation } from './components/Navigation';
import { useRef, useState } from 'react';
import { searchManga } from '@/services/mangadex/search';
import { Manga } from '@/services/mangadex/types';

export default function MangaDexPage() {
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { appService } = useEnv();
  const searchTermRef = useRef('');
  const [results, setResults] = useState<Manga[]>([]);

  const handleSearch = async (queryTerm: string) => {
    searchTermRef.current = queryTerm;

    try {
      const manga = await searchManga(queryTerm);
      setResults(manga);
    } finally {
    }
  };

  return (
    <div
      className={clsx(
        'bg-base-100 flex h-screen select-none flex-col',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className='relative top-0 z-40 w-full'
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <Navigation searchTerm={searchTermRef.current} onSearch={handleSearch} hasSearch={true} />
      </div>
      <main className='flex-1 overflow-auto'>
        {results.map((manga) => (
          <div key={manga.id}>{manga.attributes.title['ja-ro']}</div>
        ))}
      </main>
      <Toast />
    </div>
  );
}
