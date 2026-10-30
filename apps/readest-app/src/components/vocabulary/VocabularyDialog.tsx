'use client';

import React, { useState, useMemo } from 'react';
import {
  PiCards,
  PiTrash,
  PiSpeakerHigh,
  PiCheckCircle,
  PiMagnifyingGlass,
  PiDownloadSimple,
} from 'react-icons/pi';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { FlashcardStudyView } from './FlashcardStudyView';
import { pronounceWord } from '@/services/tts/wordPronouncer';

export const VocabularyDialog: React.FC = () => {
  const _ = useTranslation();
  const {
    items,
    isDialogOpen,
    setDialogOpen,
    removeWord,
    updateMastery,
    selectedBookFilter,
    setBookFilter,
    selectedMasteryFilter,
    setMasteryFilter,
    searchQuery,
    setSearchQuery,
  } = useVocabularyStore();

  const [mode, setMode] = useState<'list' | 'flashcards'>('list');

  // Distinct book titles
  const bookTitles = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.bookTitle) set.add(item.bookTitle);
    });
    return Array.from(set);
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedBookFilter !== 'ALL' && item.bookTitle !== selectedBookFilter) {
        return false;
      }
      if (selectedMasteryFilter !== 'ALL' && item.mastery !== selectedMasteryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchWord = item.word.toLowerCase().includes(query);
        const matchTrans = item.translation.toLowerCase().includes(query);
        if (!matchWord && !matchTrans) return false;
      }
      return true;
    });
  }, [items, selectedBookFilter, selectedMasteryFilter, searchQuery]);

  // Export to Markdown
  const handleExport = () => {
    if (items.length === 0) return;
    const content = [
      `# ${_('My Vocabulary')} (${new Date().toLocaleDateString()})\n`,
      `| ${_('Word')} | ${_('Translation')} | ${_('Mastery')} | ${_('Book')} |`,
      `|---|---|---|---|`,
      ...items.map(
        (it) => `| ${it.word} | ${it.translation} | ${it.mastery} | ${it.bookTitle || '-'} |`,
      ),
    ].join('\n');

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `readest-vocabulary-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      isOpen={isDialogOpen}
      onClose={() => {
        setDialogOpen(false);
        setMode('list');
      }}
      title={_('Vocabulary Builder')}
      boxClassName='sm:w-[640px]! sm:max-w-[640px]! sm:h-[80vh]!'
    >
      {mode === 'flashcards' ? (
        <FlashcardStudyView
          items={filteredItems}
          onUpdateMastery={updateMastery}
          onClose={() => setMode('list')}
        />
      ) : (
        <div className='flex h-full flex-col gap-4 pb-4 pt-1'>
          {/* Top Bar: Flashcards trigger & Export */}
          <div className='flex items-center justify-between gap-2 border-b border-base-content/10 pb-3'>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => setMode('flashcards')}
                disabled={filteredItems.length === 0}
                className='btn btn-primary btn-sm gap-1.5'
              >
                <PiCards className='h-4 w-4' />
                {_('Flashcard Study')} ({filteredItems.length})
              </button>
            </div>
            <button
              type='button'
              onClick={handleExport}
              disabled={items.length === 0}
              className='btn btn-ghost btn-sm gap-1 text-xs'
              title={_('Export as Markdown')}
            >
              <PiDownloadSimple className='h-4 w-4' />
              {_('Export')}
            </button>
          </div>

          {/* Filters Bar */}
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative flex-1 min-w-[140px]'>
              <input
                type='text'
                placeholder={_('Search vocabulary...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='input input-sm input-bordered w-full pe-8 text-xs'
              />
              <PiMagnifyingGlass className='text-base-content/40 absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2' />
            </div>

            {bookTitles.length > 0 && (
              <select
                value={selectedBookFilter}
                onChange={(e) => setBookFilter(e.target.value)}
                className='select select-sm select-bordered text-xs'
              >
                <option value='ALL'>{_('All Books')}</option>
                {bookTitles.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            )}

            <select
              value={selectedMasteryFilter}
              onChange={(e) => setMasteryFilter(e.target.value)}
              className='select select-sm select-bordered text-xs'
            >
              <option value='ALL'>{_('All Mastery')}</option>
              <option value='new'>{_('New')}</option>
              <option value='learning'>{_('Learning')}</option>
              <option value='mastered'>{_('Mastered')}</option>
            </select>
          </div>

          {/* Words List */}
          <div className='flex-1 overflow-y-auto space-y-2 pe-1'>
            {filteredItems.length === 0 ? (
              <div className='text-base-content/60 flex h-48 flex-col items-center justify-center text-center'>
                <p className='text-sm'>
                  {items.length === 0
                    ? _('No saved vocabulary yet. Save words while translating inside books!')
                    : _('No words match your filters.')}
                </p>
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className='bg-base-200/50 hover:bg-base-200 border-base-content/10 flex items-center justify-between rounded-xl border p-3 transition-colors'
                >
                  <div className='flex-1 space-y-1 pe-3'>
                    <div className='flex items-center gap-2'>
                      <span className='font-bold text-base text-base-content'>{item.word}</span>
                      <button
                        type='button'
                        onClick={() => void pronounceWord(item.word, item.sourceLang, {})}
                        className='text-base-content/50 hover:text-primary transition-colors'
                        title={_('Pronounce')}
                      >
                        <PiSpeakerHigh className='h-4 w-4' />
                      </button>
                      <span
                        className={`badge badge-xs text-[10px] uppercase font-semibold ${
                          item.mastery === 'mastered'
                            ? 'badge-success'
                            : item.mastery === 'learning'
                              ? 'badge-warning'
                              : 'badge-ghost'
                        }`}
                      >
                        {item.mastery}
                      </span>
                    </div>

                    <p dir='auto' className='text-primary font-medium text-sm'>
                      {item.translation}
                    </p>

                    {item.contextSentence && (
                      <p dir='auto' className='text-base-content/60 text-xs italic line-clamp-1'>
                        &ldquo;{item.contextSentence}&rdquo;
                      </p>
                    )}

                    {item.bookTitle && (
                      <span className='text-base-content/40 block text-[11px] truncate'>
                        {item.bookTitle}
                      </span>
                    )}
                  </div>

                  <div className='flex items-center gap-1 shrink-0'>
                    <button
                      type='button'
                      onClick={() =>
                        updateMastery(
                          item.id,
                          item.mastery === 'mastered' ? 'learning' : 'mastered',
                        )
                      }
                      className={`btn btn-circle btn-ghost btn-xs ${
                        item.mastery === 'mastered' ? 'text-success' : 'text-base-content/40'
                      }`}
                      title={_('Toggle Mastery')}
                    >
                      <PiCheckCircle className='h-4 w-4' />
                    </button>
                    <button
                      type='button'
                      onClick={() => removeWord(item.id)}
                      className='btn btn-circle btn-ghost btn-xs text-base-content/40 hover:text-error'
                      title={_('Delete')}
                    >
                      <PiTrash className='h-4 w-4' />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};
