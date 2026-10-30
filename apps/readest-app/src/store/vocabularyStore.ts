'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { VocabularyItem, VocabularyMastery } from '@/types/vocabulary';

interface VocabularyStore {
  items: VocabularyItem[];
  isDialogOpen: boolean;
  selectedBookFilter: string;
  selectedMasteryFilter: string;
  searchQuery: string;

  setDialogOpen: (open: boolean) => void;
  setBookFilter: (bookTitle: string) => void;
  setMasteryFilter: (mastery: string) => void;
  setSearchQuery: (query: string) => void;

  addWord: (data: {
    word: string;
    translation: string;
    contextSentence?: string;
    bookKey?: string;
    bookTitle?: string;
    sourceLang?: string;
    targetLang?: string;
  }) => VocabularyItem;

  removeWord: (id: string) => void;
  updateMastery: (id: string, mastery: VocabularyMastery) => void;
  recordReview: (id: string, mastery?: VocabularyMastery) => void;
  isWordSaved: (word: string) => boolean;
  clearAll: () => void;
}

export const useVocabularyStore = create<VocabularyStore>()(
  persist(
    (set, get) => ({
      items: [],
      isDialogOpen: false,
      selectedBookFilter: 'ALL',
      selectedMasteryFilter: 'ALL',
      searchQuery: '',

      setDialogOpen: (open) => set({ isDialogOpen: open }),
      setBookFilter: (bookTitle) => set({ selectedBookFilter: bookTitle }),
      setMasteryFilter: (mastery) => set({ selectedMasteryFilter: mastery }),
      setSearchQuery: (query) => set({ searchQuery: query }),

      addWord: (data) => {
        const cleanWord = data.word.trim();
        const existing = get().items.find(
          (item) => item.word.toLowerCase() === cleanWord.toLowerCase(),
        );

        if (existing) {
          const updated: VocabularyItem = {
            ...existing,
            translation: data.translation || existing.translation,
            contextSentence: data.contextSentence || existing.contextSentence,
            bookTitle: data.bookTitle || existing.bookTitle,
          };
          set((state) => ({
            items: state.items.map((it) => (it.id === existing.id ? updated : it)),
          }));
          return updated;
        }

        const newItem: VocabularyItem = {
          id: nanoid(),
          word: cleanWord,
          translation: data.translation.trim(),
          contextSentence: data.contextSentence?.trim(),
          bookKey: data.bookKey,
          bookTitle: data.bookTitle,
          sourceLang: data.sourceLang,
          targetLang: data.targetLang,
          mastery: 'new',
          reviewCount: 0,
          createdAt: Date.now(),
        };

        set((state) => ({ items: [newItem, ...state.items] }));
        return newItem;
      },

      removeWord: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),

      updateMastery: (id, mastery) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, mastery, lastReviewedAt: Date.now() } : item,
          ),
        })),

      recordReview: (id, mastery) =>
        set((state) => ({
          items: state.items.map((item) => {
            if (item.id !== id) return item;
            return {
              ...item,
              reviewCount: item.reviewCount + 1,
              lastReviewedAt: Date.now(),
              mastery: mastery ?? item.mastery,
            };
          }),
        })),

      isWordSaved: (word) => {
        const clean = word.trim().toLowerCase();
        return get().items.some((item) => item.word.toLowerCase() === clean);
      },

      clearAll: () => set({ items: [] }),
    }),
    {
      name: 'readest_vocabulary_storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
