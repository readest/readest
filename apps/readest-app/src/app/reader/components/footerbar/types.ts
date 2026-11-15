import type { BookFormat } from '@/types/book';
import { Insets } from '@/types/misc';

export interface FooterBarProps {
  bookKey: string;
  bookFormat: BookFormat;
  isHoveredAnim: boolean;
  gridInsets: Insets;
}

export interface NavigationHandlers {
  onPrevPage: () => void;
  onNextPage: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onProgressChange: (value: number) => void;
}

export interface FooterBarChildProps {
  bookKey: string;
  navigationHandlers: NavigationHandlers;
  progressFraction: number;
  progressValid: boolean;
  gridInsets: Insets;
  actionTab: string;
  forceMobileLayout: boolean;
  onSetActionTab: (tab: string) => void;
  onSpeakText: () => void;
}
