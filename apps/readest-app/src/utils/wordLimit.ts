export const MAX_REPLACEMENT_WORDS = 30;

export const getWordCount = (text: string): number => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};

export const isWordLimitExceeded = (text: string): boolean => {
  return getWordCount(text) > MAX_REPLACEMENT_WORDS;
};
