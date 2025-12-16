'use client';

import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';

export interface ReplacementConfig {
  replacementText: string;
  caseSensitive: boolean;
  scope: 'once' | 'book' | 'library';
}

interface ReplacementOptionsProps {
  isVertical: boolean;
  style: React.CSSProperties;
  selectedText: string;
  onConfirm: (config: ReplacementConfig) => void;
  onClose: () => void;
}

const ReplacementOptions: React.FC<ReplacementOptionsProps> = ({
  style,
  isVertical,
  selectedText,
  onConfirm,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [replacementText, setReplacementText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [selectedScope, setSelectedScope] = useState<'once' | 'book' | 'library' | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [adjustedStyle, setAdjustedStyle] = useState<React.CSSProperties | null>(null);
  const [isPositioned, setIsPositioned] = useState(false);
  const hasAdjusted = useRef(false);

  // Adjust position to stay within viewport - only once on initial render
  useEffect(() => {
    // Only adjust once to prevent jumping when other UI elements appear
    if (menuRef.current && !hasAdjusted.current) {
      // Use requestAnimationFrame to ensure the element is rendered before measuring
      requestAnimationFrame(() => {
        if (menuRef.current) {
          const rect = menuRef.current.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          const padding = 10;

          const newStyle = { ...style };

          // Check if popup extends beyond bottom of viewport
          if (rect.bottom > viewportHeight - padding) {
            const currentTop = parseFloat(String(style.top)) || 0;
            // Move popup above the selection instead
            newStyle.top = `${Math.max(padding, currentTop - rect.height - 40)}px`;
          }

          // Check if popup extends beyond right of viewport
          if (rect.right > viewportWidth - padding) {
            newStyle.left = `${Math.max(padding, viewportWidth - rect.width - padding)}px`;
          }

          // Check if popup extends beyond left of viewport
          if (rect.left < padding) {
            newStyle.left = `${padding}px`;
          }

          setAdjustedStyle(newStyle);
          hasAdjusted.current = true;
          setIsPositioned(true);
        }
      });
    }
  }, [style]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleScopeClick = (scope: 'once' | 'book' | 'library') => {
    if (!replacementText.trim()) {
      // Show error if no replacement text
      return;
    }
    setSelectedScope(scope);
    setShowConfirmation(true);
  };

  const handleConfirm = () => {
    if (selectedScope && replacementText.trim()) {
      onConfirm({
        replacementText: replacementText.trim(),
        caseSensitive,
        scope: selectedScope,
      });
    }
  };

  const handleCancelConfirmation = () => {
    setShowConfirmation(false);
    setSelectedScope(null);
  };

  const handleCancel = () => {
    onClose();
  };

  const getScopeLabel = (scope: 'once' | 'book' | 'library' | null) => {
    switch (scope) {
      case 'once':
        return 'this instance';
      case 'book':
        return 'all instances in this book';
      case 'library':
        return 'all instances in your library';
      default:
        return '';
    }
  };

  // Secondary confirmation dialog
  if (showConfirmation) {
    return (
      <div
        ref={menuRef}
        className={clsx(
          'replacement-options absolute flex flex-col gap-3 rounded-lg bg-gray-700 p-4',
        )}
        style={{
          ...(adjustedStyle || style),
          minWidth: '320px',
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          visibility: isPositioned ? 'visible' : 'hidden',
        }}
      >
        <div className='text-sm text-white'>
          <p className='mb-2 font-semibold'>Confirm Replacement</p>
          <p className='mb-1 text-gray-300'>
            Replace: <span className='text-yellow-300'>&quot;{selectedText}&quot;</span>
          </p>
          <p className='mb-1 text-gray-300'>
            With: <span className='text-green-300'>&quot;{replacementText}&quot;</span>
          </p>
          <p className='mb-1 text-gray-300'>
            Scope: <span className='text-blue-300'>{getScopeLabel(selectedScope)}</span>
          </p>
          <p className='text-gray-300'>
            Case sensitive: <span className='text-purple-300'>{caseSensitive ? 'Yes' : 'No'}</span>
          </p>
        </div>

        <div className='mt-2 flex gap-2'>
          <button
            onClick={handleCancelConfirmation}
            className='flex-1 rounded-md bg-gray-600 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-500'
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            className='flex-1 rounded-md bg-green-600 px-3 py-2 text-sm text-white transition-colors hover:bg-green-500'
          >
            Confirm
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className={clsx(
        'replacement-options absolute flex flex-col gap-3 rounded-lg bg-gray-700 p-4',
        isVertical ? 'flex-col' : 'flex-col',
      )}
      style={{
        ...(adjustedStyle || style),
        minWidth: '280px',
        maxHeight: 'calc(100vh - 40px)',
        overflowY: 'auto',
        visibility: isPositioned ? 'visible' : 'hidden',
      }}
    >
      {/* Selected text preview */}
      <div className='text-xs text-gray-400'>
        <span>Selected: </span>
        <span className='break-words text-yellow-300'>
          &quot;{selectedText.length > 50 ? selectedText.substring(0, 50) + '...' : selectedText}
          &quot;
        </span>
      </div>

      {/* Replacement text input */}
      <div className='flex flex-col gap-1'>
        <label htmlFor='replacement-input' className='text-xs text-gray-400'>
          Replace with:
        </label>
        <input
          ref={inputRef}
          id='replacement-input'
          type='text'
          value={replacementText}
          onChange={(e) => setReplacementText(e.target.value)}
          placeholder='Enter replacement text...'
          className='w-full rounded-md bg-gray-600 px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
        />
      </div>

      {/* Case sensitivity checkbox */}
      <label className='flex cursor-pointer items-center gap-2'>
        <input
          type='checkbox'
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.target.checked)}
          className='h-4 w-4 rounded border-gray-500 bg-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-700'
        />
        <span className='text-sm text-white'>Case Sensitive</span>
      </label>

      {/* Scope buttons */}
      <div className='mt-1 flex flex-col gap-1'>
        <button
          onClick={() => handleScopeClick('once')}
          disabled={!replacementText.trim()}
          className={clsx(
            'whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors',
            replacementText.trim() ? 'hover:bg-base-content/10' : 'cursor-not-allowed opacity-50',
          )}
        >
          Fix this once
        </button>
        <button
          onClick={() => handleScopeClick('book')}
          disabled={!replacementText.trim()}
          className={clsx(
            'whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors',
            replacementText.trim() ? 'hover:bg-base-content/10' : 'cursor-not-allowed opacity-50',
          )}
        >
          Fix in this book
        </button>
        <button
          onClick={() => handleScopeClick('library')}
          disabled={!replacementText.trim()}
          className={clsx(
            'whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-white transition-colors',
            replacementText.trim() ? 'hover:bg-base-content/10' : 'cursor-not-allowed opacity-50',
          )}
        >
          Fix in library
        </button>
      </div>

      {/* Cancel button */}
      <button
        onClick={handleCancel}
        className='mt-2 rounded-md bg-gray-600 px-3 py-2 text-sm text-white transition-colors hover:bg-gray-500'
      >
        Cancel
      </button>
    </div>
  );
};

export default ReplacementOptions;
