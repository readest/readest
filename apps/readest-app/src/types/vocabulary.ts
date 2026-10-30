export type VocabularyMastery = 'new' | 'learning' | 'mastered';

export interface VocabularyItem {
  id: string;
  word: string;
  translation: string;
  contextSentence?: string;
  bookKey?: string;
  bookTitle?: string;
  sourceLang?: string;
  targetLang?: string;
  mastery: VocabularyMastery;
  reviewCount: number;
  createdAt: number;
  lastReviewedAt?: number;
}
