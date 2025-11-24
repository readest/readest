'use client';

import clsx from 'clsx';
import React from 'react';

interface ReplacementOptionsProps {
  isVertical: boolean;
  style: React.CSSProperties;
  selectedText: string;
  onFixOnce: () => void;
  onFixInBook: () => void;
  onFixInLibrary: () => void;
  onFixAllFuture: () => void;
}

const ReplacementOptions: React.FC<ReplacementOptionsProps> = ({
  style,
  isVertical,
  onFixOnce,
  onFixInBook,
  onFixInLibrary,
  onFixAllFuture,
}) => {
  return (
    <div
      className={clsx(
        'replacement-options absolute flex gap-2 rounded-lg bg-gray-700 p-2',
        isVertical ? 'flex-col' : 'flex-col',
      )}
      style={style}
    >
      <button
        onClick={onFixOnce}
        className="hover:bg-base-content/10 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors"
      >
        Fix this once
      </button>
      <button
        onClick={onFixInBook}
        className="hover:bg-base-content/10 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors"
      >
        Fix in this book
      </button>
      <button
        onClick={onFixInLibrary}
        className="hover:bg-base-content/10 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors"
      >
        Fix in library
      </button>
      <button
        onClick={onFixAllFuture}
        className="hover:bg-base-content/10 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors"
      >
        Fix all future
      </button>
    </div>
  );
};

export default ReplacementOptions;