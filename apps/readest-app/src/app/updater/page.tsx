'use client';

import { Suspense } from 'react';
import Spinner from '@/components/Spinner';
import { UpdaterContent } from '@/components/UpdaterWindow';

const UpdaterPage = () => {
  return (
    <Suspense
      fallback={
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      }
    >
      <div className='px-12 py-4'>
        <UpdaterContent />
      </div>
    </Suspense>
  );
};

export default UpdaterPage;
