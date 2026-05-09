'use client';

import React from 'react';

// Card primitive shared by /o (annotation deeplink) and /s (share link)
// landing pages. Mirrors the visual reference in src/app/o/page.tsx so the
// two surfaces feel like the same Readest product.
export const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className='bg-base-100 border-base-300 mx-4 w-full max-w-md rounded-2xl border p-6 shadow-md sm:p-8'>
    {children}
  </div>
);
