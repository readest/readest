'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { PiCards } from 'react-icons/pi';
import { BsTranslate } from 'react-icons/bs';
import { RiDeleteBinLine } from 'react-icons/ri';
import { FiCheck, FiRefreshCw } from 'react-icons/fi';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useTranslation } from '@/hooks/useTranslation';
import { translateSingleText } from '@/services/translators/quickTranslate';
import { VocabularyItem, VocabularyMastery } from '@/types/vocabulary';
import EmptyState from '../EmptyState';

interface WordTabsViewProps {
  bookKey: string;
}

export const WordTabsView: React.FC<WordTabsViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { items, removeWord, updateMastery, updateWordTranslation, setDialogOpen } =
    useVocabularyStore();
  const [filterMode, setFilterMode] = useState<'current' | 'all'>('current');
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const filteredItems = items.filter((item) => {
    if (filterMode === 'current') {
      return item.bookKey === bookKey;
    }
    return true;
  });

  const handleTranslate = async (item: VocabularyItem) => {
    if (translatingId) return;
    setTranslatingId(item.id);
    try {
      const res = await translateSingleText(
        item.word,
        item.sourceLang || 'AUTO',
        item.targetLang || 'en',
      );
      if (res.translated) {
        updateWordTranslation(item.id, res.translated);
      }
    } catch (err) {
      console.error('Manual translate failed:', err);
    } finally {
      setTranslatingId(null);
    }
  };

  const cycleMastery = (item: VocabularyItem) => {
    const nextMastery: Record<VocabularyMastery, VocabularyMastery> = {
      new: 'learning',
      learning: 'mastered',
      mastered: 'new',
    };
    updateMastery(item.id, nextMastery[item.mastery]);
  };

  const getMasteryBadge = (mastery: VocabularyMastery) => {
    switch (mastery) {
      case 'mastered':
        return (
          <span className='badge badge-success badge-xs flex gap-0.5 py-2 font-medium'>
            <FiCheck className='size-3' />
            {_('Mastered')}
          </span>
        );
      case 'learning':
        return (
          <span className='badge badge-warning badge-xs flex gap-0.5 py-2 font-medium'>
            {_('Learning')}
          </span>
        );
      case 'new':
      default:
        return (
          <span className='badge badge-info badge-xs flex gap-0.5 py-2 font-medium'>
            {_('New')}
          </span>
        );
    }
  };

  return (
    <div className='flex h-full flex-col p-3'>
      {/* Top Header Actions */}
      <div className='mb-3 flex flex-col gap-2'>
        <button
          onClick={() => setDialogOpen(true)}
          className='btn btn-primary btn-sm flex w-full items-center justify-center gap-2 shadow-sm'
        >
          <PiCards className='size-4' />
          <span>{_('Practice Flashcards')}</span>
          <span className='badge badge-ghost badge-xs'>{filteredItems.length}</span>
        </button>

        {/* Filter Switcher */}
        <div className='tabs tabs-boxed bg-base-200 grid grid-cols-2 p-0.5'>
          <button
            onClick={() => setFilterMode('current')}
            className={clsx(
              'tab tab-sm transition-all',
              filterMode === 'current' && 'tab-active font-semibold',
            )}
          >
            {_('This Book')}
          </button>
          <button
            onClick={() => setFilterMode('all')}
            className={clsx(
              'tab tab-sm transition-all',
              filterMode === 'all' && 'tab-active font-semibold',
            )}
          >
            {_('All Words')} ({items.length})
          </button>
        </div>
      </div>

      {/* Content List */}
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {filteredItems.length === 0 ? (
          <div className='flex h-64 items-center justify-center'>
            <EmptyState
              Icon={PiCards}
              label={_('No words in Word Tabs')}
              hint={_('Select text in the book and click "Add to Word Tabs" to save it here.')}
            />
          </div>
        ) : (
          <div className='flex flex-col gap-2.5 pb-6'>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className='card border-base-300 bg-base-100 flex flex-col gap-2 rounded-xl border p-3 shadow-xs transition hover:border-primary/40'
              >
                {/* Word & Controls */}
                <div className='flex items-start justify-between gap-2'>
                  <div className='flex flex-col'>
                    <span className='text-base font-bold text-base-content select-text'>
                      {item.word}
                    </span>
                    {filterMode === 'all' && item.bookTitle && (
                      <span className='line-clamp-1 text-xs text-base-content/50'>
                        {item.bookTitle}
                      </span>
                    )}
                  </div>
                  <div className='flex items-center gap-1.5'>
                    <button
                      type='button'
                      onClick={() => cycleMastery(item)}
                      title={_('Click to change mastery')}
                      className='cursor-pointer'
                    >
                      {getMasteryBadge(item.mastery)}
                    </button>
                    <button
                      type='button'
                      onClick={() => removeWord(item.id)}
                      className='btn btn-ghost btn-xs btn-circle text-error/70 hover:text-error'
                      title={_('Delete')}
                    >
                      <RiDeleteBinLine className='size-3.5' />
                    </button>
                  </div>
                </div>

                {/* Translation or On-Demand Translation Button */}
                {item.translation ? (
                  <div className='rounded-lg bg-base-200/70 px-2.5 py-1.5 text-sm font-medium text-base-content/90 select-text'>
                    {item.translation}
                  </div>
                ) : (
                  <div className='pt-1'>
                    <button
                      type='button'
                      disabled={translatingId === item.id}
                      onClick={() => handleTranslate(item)}
                      className='btn btn-outline btn-xs flex items-center gap-1.5 font-normal'
                    >
                      {translatingId === item.id ? (
                        <FiRefreshCw className='size-3 animate-spin' />
                      ) : (
                        <BsTranslate className='size-3 text-primary' />
                      )}
                      <span>
                        {translatingId === item.id ? _('Translating...') : _('Translate')}
                      </span>
                    </button>
                  </div>
                )}

                {/* Context Sentence */}
                {item.contextSentence && item.contextSentence !== item.word && (
                  <div className='border-s-2 border-primary/30 ps-2 pt-0.5 text-xs italic text-base-content/65 select-text'>
                    "{item.contextSentence}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WordTabsView;
