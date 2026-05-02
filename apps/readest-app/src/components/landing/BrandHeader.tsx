'use client';

import React from 'react';
import Image from 'next/image';

interface BrandHeaderProps {
  title: string;
  subtitle?: string;
  alt: string;
}

export const BrandHeader: React.FC<BrandHeaderProps> = ({ title, subtitle, alt }) => (
  <div className='flex flex-col items-center text-center'>
    <Image src='/icon.png' alt={alt} width={64} height={64} priority className='mb-4 rounded-2xl' />
    <h1 className='text-base-content text-2xl font-semibold'>{title}</h1>
    {subtitle && <p className='text-base-content/70 mt-2 text-sm'>{subtitle}</p>}
  </div>
);
