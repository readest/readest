'use client';

import React from 'react';

interface PageFooterProps {
  tagline: string;
}

export const PageFooter: React.FC<PageFooterProps> = ({ tagline }) => (
  <p className='text-base-content/50 mt-6 text-center text-xs'>
    <a
      href='https://biblophile.com/'
      className='hover:text-base-content/80 font-medium transition-colors'
      target='_blank'
      rel='noopener'
    >
      Biblophile
    </a>
    <span className='mx-1.5'>·</span>
    <span>{tagline}</span>
  </p>
);
