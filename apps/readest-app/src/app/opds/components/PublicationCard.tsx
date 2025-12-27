'use client';

import { useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { CachedImage } from '@/components/CachedImage';
import { OPDSPublication, REL } from '@/types/opds';
import { groupByArray } from '../utils/opdsUtils';

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
  const _ = useTranslation();
  const linksByRel = useMemo(
    () => groupByArray(publication.links, (link) => link.rel),
    [publication.links],
  );

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
  const imageUrl = imageLink ? resolveURL(imageLink.href, baseURL) : null;

  const authors = useMemo(() => {
    return publication.metadata?.author
      ?.map((author) => (typeof author === 'string' ? author : author.name))
      .join(', ');
  }, [publication.metadata?.author]);

  const price = useMemo(() => {
    const priceLink = publication.links?.find((link) => link.properties?.price);
    if (priceLink?.properties?.price) {
      const { currency, value } = priceLink.properties.price;
      return `${currency} ${value}`;
    }
    if (linksByRel.has(REL.ACQ + '/open-access')) {
      return _('Open Access');
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publication.links, linksByRel]);

  return (
    <div
      role='none'
      onClick={onClick}
      className='card bg-base-100 cursor-pointer transition-shadow'
    >
      <figure className='bg-base-200 relative aspect-[28/41] rounded-none shadow-md'>
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
        {authors && <p className='text-base-content/70 line-clamp-1 text-xs'>{authors}</p>}
        {price && (
          <div className='card-actions mt-2 justify-end'>
            <div className='badge badge-outline badge-sm'>{price}</div>
          </div>
        )}
      </div>
    </div>
  );
}
