'use client';

import Image from 'next/image';
import { useState, useEffect, memo } from 'react';

interface CachedImageProps {
  src: string | null;
  alt: string;
  fill?: boolean;
  className?: string;
  sizes?: string;
  width?: number;
  height?: number;
  onGenerateCachedImageUrl: (url: string) => Promise<string>;
  fallback?: React.ReactNode;
}

const imageUrlCache = new Map<string, string>();
const loadingPromises = new Map<string, Promise<string>>();

const CachedImageComponent = ({
  src,
  alt,
  fill,
  className,
  sizes,
  width,
  height,
  onGenerateCachedImageUrl,
  fallback,
}: CachedImageProps) => {
  const [cachedUrl, setCachedUrl] = useState<string | null>(() => {
    return src ? imageUrlCache.get(src) || null : null;
  });
  const [loading, setLoading] = useState(() => !src || !imageUrlCache.has(src));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!src) {
      setTimeout(() => {
        setLoading(false);
      }, 0);
      return;
    }

    const cached = imageUrlCache.get(src);
    if (cached) {
      setTimeout(() => {
        setCachedUrl(cached);
        setLoading(false);
      }, 0);
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);

        let loadPromise = loadingPromises.get(src);

        if (!loadPromise) {
          loadPromise = onGenerateCachedImageUrl(src);
          loadingPromises.set(src, loadPromise);
          loadPromise.finally(() => {
            loadingPromises.delete(src);
          });
        }

        const url = await loadPromise;

        if (!cancelled) {
          imageUrlCache.set(src, url);
          setCachedUrl(url);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to load image'));
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
    };
  }, [src, onGenerateCachedImageUrl]);

  if (loading) {
    return (
      <div className={className}>
        <div className='bg-base-200 h-full w-full animate-pulse' />
      </div>
    );
  }

  if (error || !cachedUrl) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div className={`flex h-full w-full items-center justify-center ${className || ''}`}>
        <div className='text-base-content/30'>
          <svg className='h-16 w-16' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253'
            />
          </svg>
        </div>
      </div>
    );
  }

  if (fill) {
    return <Image src={cachedUrl} alt={alt} fill className={className} sizes={sizes} />;
  }

  return (
    <Image
      src={cachedUrl}
      alt={alt}
      width={width}
      height={height}
      className={className}
      sizes={sizes}
    />
  );
};

const arePropsEqual = (prevProps: CachedImageProps, nextProps: CachedImageProps) => {
  return (
    prevProps.src === nextProps.src &&
    prevProps.alt === nextProps.alt &&
    prevProps.fill === nextProps.fill &&
    prevProps.className === nextProps.className &&
    prevProps.sizes === nextProps.sizes &&
    prevProps.width === nextProps.width &&
    prevProps.height === nextProps.height
  );
};

export const CachedImage = memo(CachedImageComponent, arePropsEqual);

export const clearImageCache = () => {
  imageUrlCache.clear();
  loadingPromises.clear();
};
