export type TTSGranularity = 'sentence' | 'word';

export type TTSHighlightGranularity = 'word' | 'sentence';

export type TTSMediaMetadataMode = 'sentence' | 'paragraph' | 'chapter';

// Mini player card style: 'full' is the pre-#5162 (0.11.18) card with book
// cover, book title, chapter + timestamps; 'minimal' is the chrome-free card.
export type TTSPlayerStyle = 'full' | 'minimal';

export type TTSHighlightOptions = {
  style: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'outline';
  color: string;
};

export type TTSVoice = {
  id: string;
  name: string;
  lang: string;
  disabled?: boolean;
};

export type TTSVoicesGroup = {
  id: string;
  name: string;
  voices: TTSVoice[];
  disabled?: boolean;
};

export type TTSMark = {
  offset: number;
  name: string;
  text: string;
  language: string;
};
