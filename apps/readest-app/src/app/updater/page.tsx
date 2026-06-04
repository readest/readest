'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UpdaterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/library');
  }, [router]);

  return null;
}
