import { useRouter, redirect } from 'next/navigation';
import { isPWA, isWebAppPlatform } from '@/services/environment';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';

export const navigateToReader = (
  router: ReturnType<typeof useRouter>,
  bookIds: string[],
  queryParams?: string,
  navOptions?: { scroll?: boolean },
) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  if (isWebAppPlatform() && !isPWA()) {
    router.push(`/reader/${ids}${queryParams ? `?${queryParams}` : ''}`, navOptions);
  } else {
    const params = new URLSearchParams(queryParams || '');
    params.set('ids', ids);
    router.push(`/reader?${params.toString()}`, navOptions);
  }
};

export const navigateToLibrary = (router: ReturnType<typeof useRouter>) => {
  router.push('/library');
};

export const redirectToLibrary = () => {
  redirect('/library');
};
