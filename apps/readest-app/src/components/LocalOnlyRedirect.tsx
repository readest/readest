'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const LocalOnlyRedirect = () => {
  const router = useRouter();

  useEffect(() => {
    router.replace('/library');
  }, [router]);

  return null;
};

export default LocalOnlyRedirect;
