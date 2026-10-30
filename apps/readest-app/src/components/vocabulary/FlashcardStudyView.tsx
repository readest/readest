'use client';

import React, { useState } from 'react';
import {
  PiArrowCounterClockwise,
  PiSpeakerHigh,
  PiCheckCircle,
  PiCheck,
  PiX,
} from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { VocabularyItem, VocabularyMastery } from '@/types/vocabulary';
import { pronounceWord } from '@/services/tts/wordPronouncer';

interface FlashcardStudyViewProps {
  items: VocabularyItem[];
  onUpdateMastery: (id: string, mastery: VocabularyMastery) => void;
  onClose: () => void;
}

export const FlashcardStudyView: React.FC<FlashcardStudyViewProps> = ({
  items,
  onUpdateMastery,
  onClose,
}) => {
  const _ = useTranslation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);

  if (!items || items.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center p-12 text-center'>
        <p className='text-base-content/70 text-base'>{_('No vocabulary cards found to study.')}</p>
        <button type='button' onClick={onClose} className='btn btn-primary btn-sm mt-4'>
          {_('Back')}
        </button>
      </div>
    );
  }

  const currentItem = items[currentIndex];

  const handleNext = (mastery: VocabularyMastery) => {
    if (!currentItem) return;
    onUpdateMastery(currentItem.id, mastery);
    setIsFlipped(false);

    if (currentIndex + 1 < items.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCompleted(true);
    }
  };

  const handlePronounce = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentItem?.word) {
      void pronounceWord(currentItem.word, currentItem.sourceLang);
    }
  };

  if (completed) {
    return (
      <div className='flex flex-col items-center justify-center p-8 text-center'>
        <div className='bg-primary/10 text-primary mb-4 flex h-16 w-16 items-center justify-center rounded-full'>
          <PiCheckCircle className='h-10 w-10' />
        </div>
        <h3 className='text-lg font-bold'>{_('Session Complete!')}</h3>
        <p className='text-base-content/70 mt-1 text-sm'>
          {_('You reviewed {{count}} cards.', { count: items.length })}
        </p>
        <div className='mt-6 flex gap-3'>
          <button
            type='button'
            onClick={() => {
              setCurrentIndex(0);
              setIsFlipped(false);
              setCompleted(false);
            }}
            className='btn btn-ghost btn-sm gap-2'
          >
            <PiArrowCounterClockwise className='h-4 w-4' />
            {_('Practice Again')}
          </button>
          <button type='button' onClick={onClose} className='btn btn-primary btn-sm'>
            {_('Done')}
          </button>
        </div>
      </div>
    );
  }

  if (!currentItem) return null;

  return (
    <div className='flex flex-col items-center gap-4 p-4'>
      {/* Progress Counter */}
      <div className='text-base-content/60 flex w-full items-center justify-between text-xs'>
        <span>
          {_('Card {{current}} of {{total}}', { current: currentIndex + 1, total: items.length })}
        </span>
        {currentItem.bookTitle && (
          <span className='truncate max-w-[200px]'>{currentItem.bookTitle}</span>
        )}
      </div>

      {/* Progress Bar */}
      <div className='bg-base-300 h-1.5 w-full overflow-hidden rounded-full'>
        <div
          className='bg-primary h-full transition-all duration-300'
          style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}
        />
      </div>

      {/* Interactive Flipping Card */}
      <div
        role='button'
        tabIndex={0}
        onClick={() => setIsFlipped(!isFlipped)}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            setIsFlipped(!isFlipped);
          }
        }}
        className='bg-base-200 border-base-300 hover:border-primary/50 relative flex min-h-[220px] w-full cursor-pointer flex-col justify-between rounded-2xl border p-6 shadow-md transition-all'
      >
        <div className='flex items-start justify-between'>
          <span className='badge badge-sm badge-ghost uppercase tracking-wider text-[10px]'>
            {isFlipped ? _('Translation & Meaning') : _('Word')}
          </span>
          <button
            type='button'
            onClick={handlePronounce}
            className='btn btn-circle btn-ghost btn-xs text-base-content/70 hover:text-primary'
            title={_('Pronounce')}
          >
            <PiSpeakerHigh className='h-4 w-4' />
          </button>
        </div>

        <div className='my-auto text-center'>
          {!isFlipped ? (
            <div className='space-y-3'>
              <h2 className='text-2xl font-bold tracking-tight text-base-content'>
                {currentItem.word}
              </h2>
              {currentItem.contextSentence && (
                <p dir='auto' className='text-base-content/70 italic text-sm'>
                  &ldquo;{currentItem.contextSentence}&rdquo;
                </p>
              )}
            </div>
          ) : (
            <div className='space-y-2'>
              <h2 dir='auto' className='text-xl font-semibold text-primary'>
                {currentItem.translation}
              </h2>
              <p className='text-base-content/50 text-xs'>{currentItem.word}</p>
            </div>
          )}
        </div>

        <div className='text-base-content/40 text-center text-[11px]'>
          {isFlipped ? _('Click to see front') : _('Click to flip')}
        </div>
      </div>

      {/* Rating actions */}
      <div className='flex w-full items-center justify-center gap-3 pt-2'>
        <button
          type='button'
          onClick={() => handleNext('learning')}
          className='btn btn-outline btn-warning btn-sm flex-1 gap-1'
        >
          <PiX className='h-4 w-4' />
          {_('Learning')}
        </button>
        <button
          type='button'
          onClick={() => handleNext('mastered')}
          className='btn btn-outline btn-success btn-sm flex-1 gap-1'
        >
          <PiCheck className='h-4 w-4' />
          {_('Mastered')}
        </button>
      </div>
    </div>
  );
};
