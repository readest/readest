'use client';


import clsx from 'clsx';
import React from 'react';

interface ReplacementMenuProps {
  className?: string;
}

const ReplacementMenu: React.FC<ReplacementMenuProps> = ({ className }) => {
  return (
    <div
      className={clsx(
        'bg-base-300 absolute rounded-lg shadow-xl font-sans border-4 border-red-500',
        'w-48 p-2',
        className,
      )}
      style={{
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
      }}
    >
      <div className="flex flex-col gap-1">
        <button 
          className="px-3 py-2 hover:bg-base-content/10 rounded-md text-sm text-left transition-colors"
          onClick={() => console.log('Fix this once')}
        >
          Fix this once
        </button>
        <button 
          className="px-3 py-2 hover:bg-base-content/10 rounded-md text-sm text-left transition-colors"
          onClick={() => console.log('Fix in this book')}
        >
          Fix in this book
        </button>
        <button 
          className="px-3 py-2 hover:bg-base-content/10 rounded-md text-sm text-left transition-colors"
          onClick={() => console.log('Fix in library')}
        >
          Fix in library
        </button>
        <button 
          className="px-3 py-2 hover:bg-base-content/10 rounded-md text-sm text-left transition-colors"
          onClick={() => console.log('Fix all future')}
        >
          Fix all future
        </button>
      </div>
    </div>
  );
};

export default ReplacementMenu;