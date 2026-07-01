'use client';

import { useMemo } from 'react';
import { CachedImage } from '@/components/CachedImage';
import { OPDSPublication, REL } from '@/types/opds';

interface PublicationCardProps {
  publication: OPDSPublication;
  baseURL: string;
  onClick: () => void;
  resolveURL: (url: string, base: string) => string;
  onGenerateCachedImageUrl: (url: string) => Promise<string>;
}

export function PublicationCard({
  publication,
  baseURL,
  onClick,
  resolveURL,
  onGenerateCachedImageUrl,
}: PublicationCardProps) {
  const thumbnailImage = useMemo(() => {
    const thumbnails = publication.images?.filter((img) =>
      REL.THUMBNAIL.some((rel: string) => img.rel?.includes(rel)),
    );
    return thumbnails?.[0] || publication.images?.[0];
  }, [publication.images]);

  const coverImage = useMemo(() => {
    const covers = publication.images?.filter((img) =>
      REL.COVER.some((rel: string) => img.rel?.includes(rel)),
    );
    return covers?.[0];
  }, [publication.images]);

  const imageLink = coverImage || thumbnailImage;
  const imageUrl = imageLink?.href ? resolveURL(imageLink.href, baseURL) : null;

  const authors = useMemo(() => {
    const author = publication.metadata?.author;
    if (!author) return undefined;

    const authorList = Array.isArray(author) ? author : [author];

    return authorList.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
  }, [publication.metadata?.author]);

  return (
    <div role='none' onClick={onClick} className='card cursor-pointer transition-shadow'>
      <figure className='bg-base-200 relative aspect-[28/41] overflow-hidden rounded shadow-md'>
        <CachedImage
          src={imageUrl}
          alt={publication.metadata?.title || 'Book cover'}
          fill
          className='object-cover'
          sizes='(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
          onGenerateCachedImageUrl={onGenerateCachedImageUrl}
        />
      </figure>
      <div className='py-3'>
        <h3 className='card-title line-clamp-1 text-sm'>
          {publication.metadata?.title || 'Untitled'}
        </h3>
        {authors && authors.length > 0 && (
          <p className='text-base-content/70 line-clamp-1 text-xs'>{authors.join(', ')}</p>
        )}
      </div>
    </div>
  );
}
