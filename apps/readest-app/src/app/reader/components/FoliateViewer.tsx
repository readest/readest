import clsx from 'clsx';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { convertBlobUrlToDataUrl, BookDoc, getDirection } from '@/libs/document';
import { BookConfig, PageInfo } from '@/types/book';
import { FoliateView, wrappedFoliateView } from '@/types/view';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import { useMouseEvent, useTouchEvent, useLongPressEvent } from '../hooks/useIframeEvents';
import { usePagination, viewPagination } from '../hooks/usePagination';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useProgressSync } from '../hooks/useProgressSync';
import { useProgressAutoSave } from '../hooks/useProgressAutoSave';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useTranslation } from '@/hooks/useTranslation';
import { useEinkMode } from '@/hooks/useEinkMode';
import { useKOSync } from '../hooks/useKOSync';
import { resolveBookThemeFromBook, type BookThemeConfig } from '@/styles/book-themes';
import {
  getHouseForCharacter,
  extractCharacterFromChapterTitle,
  extractChapterLabel,
} from '@/data/got-houses';
import { getOrnamentAsset } from '@/styles/ornaments';
import {
  applyFixedlayoutStyles,
  applyImageStyle,
  applyScrollbarStyle,
  applyScrollModeClass,
  applyTableStyle,
  applyThemeModeClass,
  applyTranslationStyle,
  getStyles,
  getThemeCode,
  keepTextAlignment,
  transformStylesheet,
} from '@/utils/style';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { getBookDirFromLanguage, getBookDirFromWritingMode } from '@/utils/book';
import { getIndexFromCfi } from '@/utils/cfi';
import { useUICSS } from '@/hooks/useUICSS';
import {
  handleKeydown,
  handleKeyup,
  handleMousedown,
  handleMouseup,
  handleClick,
  handleWheel,
  handleTouchStart,
  handleTouchMove,
  handleTouchEnd,
  addLongPressListeners,
} from '../utils/iframeEventHandlers';
import { getMaxInlineSize } from '@/utils/config';
import { getDirFromUILanguage } from '@/utils/rtl';
import { isTauriAppPlatform } from '@/services/environment';
import { TransformContext } from '@/services/transformers/types';
import { transformContent } from '@/services/transformService';
import { lockScreenOrientation } from '@/utils/bridge';
import { useTextTranslation } from '../hooks/useTextTranslation';
import { useBookCoverAutoSave } from '../hooks/useAutoSaveBookCover';
import { useDiscordPresence } from '@/hooks/useDiscordPresence';
import { manageSyntaxHighlighting } from '@/utils/highlightjs';
import { getViewInsets } from '@/utils/insets';
import { handleA11yNavigation } from '@/utils/a11y';
import { isCJKLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';
import { isFontType } from '@/utils/font';
import { ParagraphControl } from './paragraph';
import Spinner from '@/components/Spinner';
import KOSyncConflictResolver from './KOSyncResolver';
import ImageViewer from './ImageViewer';
import TableViewer from './TableViewer';

declare global {
  interface Window {
    eval(script: string): void;
  }
}

const CITADEL_BOOK_PAGE_STYLE_ID = 'citadel-book-page-style';
const CITADEL_DROP_CAP_CLASS = 'citadel-drop-cap-paragraph';
const CITADEL_CHAPTER_OPENING_CLASS = 'citadel-chapter-opening';
const CITADEL_CHAPTER_TITLE_CLASS = 'citadel-chapter-title';
const CITADEL_CHAPTER_ORNAMENT_CLASS = 'citadel-chapter-ornament';
const CITADEL_CHAPTER_SIGIL_CLASS = 'citadel-chapter-sigil';
const CITADEL_ORNAMENT_DIVIDER_CLASS = 'citadel-ornament-divider';
const CITADEL_THEMED_OPENING_CLASS = 'citadel-themed-opening';
const CITADEL_CORNER_ORNAMENT_CLASS = 'citadel-corner-ornament';
const CITADEL_CORNER_TL_CLASS = 'citadel-corner-tl';
const CITADEL_CORNER_TR_CLASS = 'citadel-corner-tr';
const CITADEL_CORNER_BL_CLASS = 'citadel-corner-bl';
const CITADEL_CORNER_BR_CLASS = 'citadel-corner-br';
const CITADEL_GOT_HEADER_CLASS = 'citadel-got-header';
const CITADEL_GOT_CHAPTER_LABEL_CLASS = 'citadel-got-chapter-label';
const CITADEL_GOT_ORNAMENT_SIDE_CLASS = 'citadel-got-ornament-side';
const CITADEL_GOT_ORNAMENT_LINE_WRAP_CLASS = 'citadel-got-ornament-line-wrap';

const CITADEL_CHAPTER_HEADING_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  '.chapter',
  '.chapter-title',
  '.title',
  '.heading',
  '[epub\\:type~="title"]',
].join(', ');

const CITADEL_BOOK_PAGE_CSS = `
  :root {
    --citadel-page-text-max-width: 36.2em;
    --citadel-page-block-width: min(
      100%,
      calc(var(--citadel-page-text-max-width) + var(--citadel-page-outer-pad) + var(--citadel-page-gutter-pad))
    );
    --citadel-page-text-color: rgba(236, 228, 212, 0.92);
    --citadel-page-muted-gold: #a97935;
    --citadel-page-title-gold: #d2aa62;
    --citadel-page-dropcap-gold: #d49a37;
    --citadel-page-border-gold: rgba(210, 160, 94, 0.82);
    --citadel-page-border-gold-soft: rgba(148, 112, 64, 0.44);
    --citadel-page-outer-pad: 1.55rem;
    --citadel-page-gutter-pad: 2.3rem;
    --citadel-page-top-pad: 1.36rem;
  }

  html[data-citadel-page-side='left'] {
    --citadel-page-outer-pad: 1.4rem;
    --citadel-page-gutter-pad: 2.45rem;
    --citadel-page-top-pad: 1.34rem;
  }

  html[data-citadel-page-side='right'] {
    --citadel-page-outer-pad: 1.5rem;
    --citadel-page-gutter-pad: 2.5rem;
    --citadel-page-top-pad: 2.2rem;
  }

  html[data-citadel-page-side='center'] {
    --citadel-page-outer-pad: 1.55rem;
    --citadel-page-gutter-pad: 2.1rem;
    --citadel-page-top-pad: 1.5rem;
  }

  body {
    position: relative !important;
    padding-top: var(--citadel-page-top-pad) !important;
    color: var(--citadel-page-text-color) !important;
    line-height: 1.58 !important;
    text-rendering: optimizeLegibility !important;
    background-color: transparent !important;
  }

  body::before {
    content: '' !important;
    position: absolute !important;
    inset: 10px 12px !important;
    pointer-events: none !important;
    border-radius: 10px !important;
    z-index: 999 !important;
    background:
      linear-gradient(90deg, var(--citadel-page-border-gold), transparent) top 20px left 20px / 44px 2px no-repeat,
      linear-gradient(180deg, var(--citadel-page-border-gold), transparent) top 20px left 20px / 2px 44px no-repeat,
      linear-gradient(45deg, transparent 42%, rgba(206, 164, 96, 0.74) 50%, transparent 58%) top 17px left 17px / 20px 20px no-repeat,
      radial-gradient(circle at top 20px left 20px, rgba(198, 156, 94, 0.34) 0 2px, transparent 2.3px),
      linear-gradient(90deg, transparent, var(--citadel-page-border-gold)) top 20px right 20px / 44px 2px no-repeat,
      linear-gradient(180deg, var(--citadel-page-border-gold), transparent) top 20px right 20px / 2px 44px no-repeat,
      linear-gradient(-45deg, transparent 42%, rgba(206, 164, 96, 0.74) 50%, transparent 58%) top 17px right 17px / 20px 20px no-repeat,
      radial-gradient(circle at top 20px right 20px, rgba(198, 156, 94, 0.34) 0 2px, transparent 2.3px),
      linear-gradient(90deg, var(--citadel-page-border-gold), transparent) bottom 20px left 20px / 44px 2px no-repeat,
      linear-gradient(180deg, transparent, var(--citadel-page-border-gold)) bottom 20px left 20px / 2px 44px no-repeat,
      linear-gradient(-45deg, transparent 42%, rgba(206, 164, 96, 0.74) 50%, transparent 58%) bottom 17px left 17px / 20px 20px no-repeat,
      radial-gradient(circle at bottom 20px left 20px, rgba(198, 156, 94, 0.34) 0 2px, transparent 2.3px),
      linear-gradient(90deg, transparent, var(--citadel-page-border-gold)) bottom 20px right 20px / 44px 2px no-repeat,
      linear-gradient(180deg, transparent, var(--citadel-page-border-gold)) bottom 20px right 20px / 2px 44px no-repeat,
      linear-gradient(45deg, transparent 42%, rgba(206, 164, 96, 0.74) 50%, transparent 58%) bottom 17px right 17px / 20px 20px no-repeat,
      radial-gradient(circle at bottom 20px right 20px, rgba(198, 156, 94, 0.34) 0 2px, transparent 2.3px) !important;
    opacity: 0.98 !important;
  }

  p,
  blockquote,
  ul,
  ol,
  pre,
  table,
  figure,
  img,
  svg {
    width: var(--citadel-page-block-width) !important;
    max-width: var(--citadel-page-block-width) !important;
    margin-left: auto !important;
    margin-right: auto !important;
    box-sizing: border-box !important;
  }

  html[data-citadel-page-side='left'] p,
  html[data-citadel-page-side='left'] blockquote,
  html[data-citadel-page-side='left'] ul,
  html[data-citadel-page-side='left'] ol,
  html[data-citadel-page-side='left'] pre,
  html[data-citadel-page-side='left'] table,
  html[data-citadel-page-side='left'] figure,
  html[data-citadel-page-side='left'] img,
  html[data-citadel-page-side='left'] svg,
  html[data-citadel-page-side='left'] h1,
  html[data-citadel-page-side='left'] h2,
  html[data-citadel-page-side='left'] h3,
  html[data-citadel-page-side='left'] h4,
  html[data-citadel-page-side='left'] .chapter,
  html[data-citadel-page-side='left'] .chapter-title,
  html[data-citadel-page-side='left'] .title,
  html[data-citadel-page-side='left'] .heading,
  html[data-citadel-page-side='left'] [epub\\:type~="title"] {
    padding-left: var(--citadel-page-outer-pad) !important;
    padding-right: var(--citadel-page-gutter-pad) !important;
  }

  html[data-citadel-page-side='right'] p,
  html[data-citadel-page-side='right'] blockquote,
  html[data-citadel-page-side='right'] ul,
  html[data-citadel-page-side='right'] ol,
  html[data-citadel-page-side='right'] pre,
  html[data-citadel-page-side='right'] table,
  html[data-citadel-page-side='right'] figure,
  html[data-citadel-page-side='right'] img,
  html[data-citadel-page-side='right'] svg,
  html[data-citadel-page-side='right'] h1,
  html[data-citadel-page-side='right'] h2,
  html[data-citadel-page-side='right'] h3,
  html[data-citadel-page-side='right'] h4,
  html[data-citadel-page-side='right'] .chapter,
  html[data-citadel-page-side='right'] .chapter-title,
  html[data-citadel-page-side='right'] .title,
  html[data-citadel-page-side='right'] .heading,
  html[data-citadel-page-side='right'] [epub\\:type~="title"] {
    padding-left: var(--citadel-page-gutter-pad) !important;
    padding-right: var(--citadel-page-outer-pad) !important;
  }

  html[data-citadel-page-side='center'] p,
  html[data-citadel-page-side='center'] blockquote,
  html[data-citadel-page-side='center'] ul,
  html[data-citadel-page-side='center'] ol,
  html[data-citadel-page-side='center'] pre,
  html[data-citadel-page-side='center'] table,
  html[data-citadel-page-side='center'] figure,
  html[data-citadel-page-side='center'] img,
  html[data-citadel-page-side='center'] svg,
  html[data-citadel-page-side='center'] h1,
  html[data-citadel-page-side='center'] h2,
  html[data-citadel-page-side='center'] h3,
  html[data-citadel-page-side='center'] h4,
  html[data-citadel-page-side='center'] .chapter,
  html[data-citadel-page-side='center'] .chapter-title,
  html[data-citadel-page-side='center'] .title,
  html[data-citadel-page-side='center'] .heading,
  html[data-citadel-page-side='center'] [epub\\:type~="title"] {
    padding-left: var(--citadel-page-outer-pad) !important;
    padding-right: var(--citadel-page-outer-pad) !important;
  }

  p {
    margin-top: 0 !important;
    margin-bottom: 0.86em !important;
  }

  html[data-citadel-page-side='center'] body:not(.${CITADEL_CHAPTER_OPENING_CLASS}) p:first-of-type {
    margin-top: 0.52rem !important;
  }

  html[data-citadel-page-side='right'] body:not(.${CITADEL_CHAPTER_OPENING_CLASS}) p:first-of-type {
    margin-top: 1.5rem !important;
  }

  h1,
  h2,
  h3,
  h4,
  .chapter,
  .chapter-title,
  .title,
  .heading,
  [epub\\:type~="title"] {
    margin-left: auto !important;
    margin-right: auto !important;
  }

  @supports (initial-letter: 3) {
    ${'.' + CITADEL_DROP_CAP_CLASS}::first-letter {
      initial-letter: 3 !important;
      float: none !important;
      margin: 0 0.12em 0 0 !important;
      padding: 0 !important;
      color: var(--citadel-page-dropcap-gold) !important;
      font-weight: 550 !important;
      text-shadow: 0 0 12px rgba(168, 86, 24, 0.2) !important;
    }
  }

  @supports not (initial-letter: 3) {
    ${'.' + CITADEL_DROP_CAP_CLASS}::first-letter {
      float: left !important;
      margin: 0.02em 0.12em 0.04em 0 !important;
      padding: 0 !important;
      color: var(--citadel-page-dropcap-gold) !important;
      font-size: 3.0rem !important;
      line-height: 0.76 !important;
      font-weight: 550 !important;
      text-shadow: 0 0 12px rgba(168, 86, 24, 0.2) !important;
    }
  }

  ${'.' + CITADEL_DROP_CAP_CLASS} {
    text-indent: 0 !important;
    min-height: 0 !important;
    overflow: visible !important;
    clear: none !important;
  }

  ${'.' + CITADEL_DROP_CAP_CLASS}::first-line {
    line-height: 1.48 !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_TITLE_CLASS} {
    position: relative !important;
    margin-top: 0.6em !important;
    margin-bottom: 0.36em !important;
    text-align: center !important;
    color: var(--citadel-page-title-gold) !important;
    font-family: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif !important;
    font-size: clamp(1.2rem, 2.2vw, 1.7rem) !important;
    line-height: 1.1 !important;
    letter-spacing: 0.14em !important;
    text-transform: uppercase !important;
    font-weight: 550 !important;
    text-shadow: 0 1px 0 rgba(28, 16, 9, 0.4), 0 0 10px rgba(134, 74, 23, 0.1) !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_TITLE_CLASS}::before,
  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_TITLE_CLASS}::after {
    content: '' !important;
    display: block !important;
    width: min(8rem, 38%) !important;
    height: 16px !important;
    margin-left: auto !important;
    margin-right: auto !important;
    background:
      linear-gradient(90deg, transparent 0%, rgba(198, 152, 84, 0.26) 12%, rgba(214, 170, 100, 0.82) 50%, rgba(198, 152, 84, 0.26) 88%, transparent 100%) center / 100% 1.4px no-repeat,
      linear-gradient(45deg, transparent 40%, rgba(218, 174, 104, 0.84) 50%, transparent 60%) center / 10px 10px no-repeat,
      linear-gradient(-45deg, transparent 40%, rgba(218, 174, 104, 0.84) 50%, transparent 60%) center / 10px 10px no-repeat,
      radial-gradient(circle at center, rgba(224, 180, 112, 0.62) 0 1.3px, transparent 1.5px) center / 100% 100% no-repeat !important;
    opacity: 0.9 !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_TITLE_CLASS}::before {
    margin-bottom: 0.35em !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_TITLE_CLASS}::after {
    width: min(6rem, 28%) !important;
    margin-top: 0.24em !important;
    opacity: 0.72 !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_DROP_CAP_CLASS} {
    margin-top: 0.15em !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_ORNAMENT_CLASS} {
    margin-bottom: 0.7rem !important;
    opacity: 0.94 !important;
  }

  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_ORNAMENT_CLASS} img,
  ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_ORNAMENT_CLASS} svg {
    margin-bottom: 0 !important;
  }

  .${CITADEL_CHAPTER_SIGIL_CLASS} {
    display: block !important;
    max-height: 42px !important;
    width: auto !important;
    margin: 0.3em auto 0.4em auto !important;
    opacity: 0.88 !important;
    filter:
      brightness(0.92)
      sepia(0.28)
      saturate(1.6)
      hue-rotate(-1deg)
      drop-shadow(0 2px 4px rgba(0,0,0,0.22)) !important;
  }

  .${CITADEL_ORNAMENT_DIVIDER_CLASS} {
    display: block !important;
    max-height: 34px !important;
    width: auto !important;
    max-width: min(12rem, 48%) !important;
    margin: 0 auto !important;
    opacity: 0.9 !important;
    filter: brightness(0.78) sepia(0.32) saturate(1.3) drop-shadow(0 1px 3px rgba(0,0,0,0.2)) !important;
  }

  .${CITADEL_ORNAMENT_DIVIDER_CLASS}.ornament-divider-above {
    margin-bottom: 0.8em !important;
  }

  .${CITADEL_ORNAMENT_DIVIDER_CLASS}.ornament-divider-below {
    margin-top: 0.52em !important;
    max-width: min(7.5rem, 30%) !important;
    opacity: 0.78 !important;
  }

  .${CITADEL_THEMED_OPENING_CLASS} .${CITADEL_CHAPTER_TITLE_CLASS} {
    margin-top: 0.3em !important;
    margin-bottom: 0.36em !important;
  }

  .${CITADEL_THEMED_OPENING_CLASS} .${CITADEL_CHAPTER_TITLE_CLASS}::before,
  .${CITADEL_THEMED_OPENING_CLASS} .${CITADEL_CHAPTER_TITLE_CLASS}::after {
    display: none !important;
  }

  /* ── GOT / ASOIAF chapter header ── */
  .${CITADEL_GOT_HEADER_CLASS} {
    text-align: center !important;
    margin: 0.4em 0 0.2em 0 !important;
  }

  .${CITADEL_GOT_CHAPTER_LABEL_CLASS} {
    text-align: center !important;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif !important;
    font-size: clamp(0.78rem, 1.4vw, 0.92rem) !important;
    letter-spacing: 0.22em !important;
    text-transform: uppercase !important;
    color: var(--citadel-page-muted-gold) !important;
    margin-bottom: 0.12em !important;
    font-weight: 450 !important;
  }

  .${CITADEL_GOT_HEADER_CLASS} .${CITADEL_CHAPTER_TITLE_CLASS} {
    margin-top: 0 !important;
    margin-bottom: 0.14em !important;
    font-size: clamp(1.4rem, 3vw, 2rem) !important;
    letter-spacing: 0.18em !important;
  }

  .${CITADEL_GOT_ORNAMENT_LINE_WRAP_CLASS} {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    margin: 0.3em auto 0.5em auto !important;
    max-width: min(18rem, 62%) !important;
    gap: 2px !important;
  }

  .${CITADEL_GOT_ORNAMENT_SIDE_CLASS} {
    flex: 1 1 0 !important;
    min-width: 14px !important;
    height: 1.4px !important;
    border: 0 !important;
    background:
      linear-gradient(90deg, transparent 0%, var(--citadel-page-border-gold) 62%) 0 50% / 100% 1.4px no-repeat !important;
    opacity: 0.82 !important;
  }

  .${CITADEL_GOT_ORNAMENT_SIDE_CLASS}.got-ornament-right {
    background:
      linear-gradient(90deg, var(--citadel-page-border-gold) 0%, transparent 100%) 0 50% / 100% 1.4px no-repeat !important;
  }

  .${CITADEL_GOT_ORNAMENT_LINE_WRAP_CLASS} .${CITADEL_CHAPTER_SIGIL_CLASS} {
    flex-shrink: 0 !important;
    width: 40px !important;
    height: 40px !important;
    margin: 0 5px !important;
    display: block !important;
    background-color: #c4953a !important;
    mask-size: contain !important;
    mask-repeat: no-repeat !important;
    mask-position: center !important;
    -webkit-mask-size: contain !important;
    -webkit-mask-repeat: no-repeat !important;
    -webkit-mask-position: center !important;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2)) !important;
  }

  /* ── End GOT header ── */

  .${CITADEL_CORNER_ORNAMENT_CLASS} {
    position: absolute !important;
    pointer-events: none !important;
    z-index: 1000 !important;
    width: 56px !important;
    height: 56px !important;
    opacity: 0.88 !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    filter: brightness(0.84) sepia(0.22) saturate(1.25)
      drop-shadow(0 2px 5px rgba(0,0,0,0.3)) !important;
  }
  .${CITADEL_CORNER_TL_CLASS} { top: 8px !important; left: 8px !important; }
  .${CITADEL_CORNER_TR_CLASS} { top: 8px !important; right: 8px !important; transform: scaleX(-1) !important; }
  .${CITADEL_CORNER_BL_CLASS} { bottom: 8px !important; left: 8px !important; transform: scaleY(-1) !important; }
  .${CITADEL_CORNER_BR_CLASS} { bottom: 8px !important; right: 8px !important; transform: scale(-1, -1) !important; }

  @media (max-width: 900px) {
    :root {
      --citadel-page-text-max-width: 32em;
      --citadel-page-outer-pad: 1.1rem;
      --citadel-page-gutter-pad: 1.5rem;
      --citadel-page-top-pad: 1.08rem;
    }

    body::before {
      inset: 12px 12px !important;
    }

    @supports (initial-letter: 2) {
      ${'.' + CITADEL_DROP_CAP_CLASS}::first-letter {
        initial-letter: 2 !important;
      }
    }
    @supports not (initial-letter: 2) {
      ${'.' + CITADEL_DROP_CAP_CLASS}::first-letter {
        font-size: 2.5rem !important;
      }
    }

    ${'.' + CITADEL_CHAPTER_OPENING_CLASS} ${'.' + CITADEL_CHAPTER_TITLE_CLASS} {
      font-size: clamp(1.2rem, 4vw, 1.58rem) !important;
      letter-spacing: 0.14em !important;
    }

    .${CITADEL_CHAPTER_SIGIL_CLASS} {
      max-height: 30px !important;
      margin: 0.2em auto 0.32em auto !important;
      opacity: 0.82 !important;
    }

    .${CITADEL_ORNAMENT_DIVIDER_CLASS} {
      max-height: 24px !important;
      max-width: min(8rem, 36%) !important;
    }

    .${CITADEL_CORNER_ORNAMENT_CLASS} {
      width: 42px !important;
      height: 42px !important;
    }
    .${CITADEL_CORNER_TL_CLASS} { top: 6px !important; left: 6px !important; }
    .${CITADEL_CORNER_TR_CLASS} { top: 6px !important; right: 6px !important; }
    .${CITADEL_CORNER_BL_CLASS} { bottom: 6px !important; left: 6px !important; }
    .${CITADEL_CORNER_BR_CLASS} { bottom: 6px !important; right: 6px !important; }
  }
`;

const isCitadelDropCapCandidate = (element: Element) => {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length < 80) return false;
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(text)) return false;
  const letters = text.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (letters.length > 0 && letters === letters.toUpperCase()) return false;
  return true;
};

const isCitadelChapterHeadingCandidate = (element: Element) => {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length < 2 || text.length > 64) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(text)) return false;
  if (/[:;!?]$/.test(text)) return false;
  return true;
};

const isCitadelChapterOrnamentCandidate = (element: Element) => {
  if (!(element instanceof HTMLElement)) return false;
  if (element.matches('figure, img, svg')) return true;
  if (element.matches('p, div')) {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    const hasSingleVisual = element.childElementCount === 1 && !!element.querySelector('img, svg');
    return hasSingleVisual || text.length <= 3;
  }
  return false;
};

const getCitadelPageSide = (doc: Document): 'left' | 'right' | 'center' => {
  const iframe = doc.defaultView?.frameElement as HTMLElement | null;
  const parent = iframe?.parentElement;
  if (!iframe || !parent) return 'center';

  const iframeRect = iframe.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  if (!iframeRect.width || !parentRect.width) return 'center';

  const iframeCenter = iframeRect.left + iframeRect.width / 2;
  const parentCenter = parentRect.left + parentRect.width / 2;
  const delta = iframeCenter - parentCenter;
  const threshold = Math.max(24, iframeRect.width * 0.1);

  if (delta < -threshold) return 'left';
  if (delta > threshold) return 'right';
  return 'center';
};

const getCitadelChapterOpening = (doc: Document) => {
  const flowNodes = Array.from(
    doc.body?.querySelectorAll(`${CITADEL_CHAPTER_HEADING_SELECTOR}, p`) || [],
  ).filter((element) => {
    if (element.closest('blockquote, aside, nav, header, footer, figcaption')) return false;
    return !!(element.textContent || '').replace(/\s+/g, ' ').trim();
  });

  const heading = flowNodes.find((element, index) => {
    if (index > 3) return false;
    if (!element.matches(CITADEL_CHAPTER_HEADING_SELECTOR)) return false;
    return isCitadelChapterHeadingCandidate(element);
  });

  if (!heading) return { heading: null, paragraph: null };

  const headingIndex = flowNodes.indexOf(heading);
  const paragraph = flowNodes.slice(headingIndex + 1).find((element) => {
    if (!element.matches('p')) return false;
    return isCitadelDropCapCandidate(element);
  });

  if (!paragraph) return { heading: null, paragraph: null };
  return { heading, paragraph };
};

const buildBookThemeCSS = (theme: BookThemeConfig): string => {
  if (!theme || theme.id === 'default') return '';

  const textureCSS =
    theme.textureId && theme.textureId !== 'none'
      ? `
    body::after {
      content: '' !important;
      position: fixed !important;
      inset: 0 !important;
      pointer-events: none !important;
      z-index: 0 !important;
      opacity: ${theme.textureOpacity ?? 0.06} !important;
      mix-blend-mode: ${theme.textureBlendMode ?? 'multiply'} !important;
      background-repeat: repeat !important;
      background-size: 300px 300px !important;
    }`
      : '';

  return `
    :root {
      --citadel-ornament-style: '${theme.ornamentStyle}';
    }
    body::before {
      opacity: 0 !important;
    }
    ${textureCSS}
  `;
};

const applyCitadelBookPageStyles = (
  doc: Document,
  isFixedLayout?: boolean,
  theme?: BookThemeConfig,
) => {
  if (isFixedLayout) return;

  const themeCSS = theme ? buildBookThemeCSS(theme) : '';
  const fullCSS = CITADEL_BOOK_PAGE_CSS + themeCSS;

  const existingStyle = doc.getElementById(CITADEL_BOOK_PAGE_STYLE_ID);
  if (existingStyle) {
    existingStyle.textContent = fullCSS;
  } else {
    const style = doc.createElement('style');
    style.id = CITADEL_BOOK_PAGE_STYLE_ID;
    style.textContent = fullCSS;
    (doc.head || doc.documentElement).appendChild(style);
  }

  // Clean up previously applied classes
  doc.querySelectorAll(`.${CITADEL_DROP_CAP_CLASS}`).forEach((element) => {
    element.classList.remove(CITADEL_DROP_CAP_CLASS);
  });
  doc.querySelectorAll(`.${CITADEL_CHAPTER_TITLE_CLASS}`).forEach((element) => {
    element.classList.remove(CITADEL_CHAPTER_TITLE_CLASS);
  });
  doc.querySelectorAll(`.${CITADEL_CHAPTER_ORNAMENT_CLASS}`).forEach((element) => {
    element.classList.remove(CITADEL_CHAPTER_ORNAMENT_CLASS);
  });
  // Clean up injected elements from previous page
  doc.querySelectorAll(`.${CITADEL_CHAPTER_SIGIL_CLASS}`).forEach((el) => el.remove());
  doc.querySelectorAll(`.${CITADEL_ORNAMENT_DIVIDER_CLASS}`).forEach((el) => el.remove());
  doc.querySelectorAll(`.${CITADEL_CORNER_ORNAMENT_CLASS}`).forEach((el) => el.remove());
  doc.querySelectorAll(`.${CITADEL_GOT_HEADER_CLASS}`).forEach((el) => {
    // Unwrap GOT header: move heading back to parent before removing container
    const heading = el.querySelector(`.${CITADEL_CHAPTER_TITLE_CLASS}`);
    if (heading && el.parentNode) {
      el.parentNode.insertBefore(heading, el);
    }
    el.remove();
  });
  doc.querySelectorAll(`.${CITADEL_GOT_CHAPTER_LABEL_CLASS}`).forEach((el) => el.remove());
  doc.querySelectorAll(`.${CITADEL_GOT_ORNAMENT_LINE_WRAP_CLASS}`).forEach((el) => el.remove());
  doc.body?.classList.remove(CITADEL_CHAPTER_OPENING_CLASS);
  doc.body?.classList.remove(CITADEL_THEMED_OPENING_CLASS);
  doc.documentElement.setAttribute('data-citadel-page-side', getCitadelPageSide(doc));

  const { heading, paragraph } = getCitadelChapterOpening(doc);

  if (heading && paragraph) {
    doc.body?.classList.add(CITADEL_CHAPTER_OPENING_CLASS);
    heading.classList.add(CITADEL_CHAPTER_TITLE_CLASS);

    const isThemed = theme && theme.id !== 'default';

    if (isThemed) {
      doc.body?.classList.add(CITADEL_THEMED_OPENING_CLASS);

      if (theme.useSigils) {
        // ── GOT / ASOIAF integrated chapter header ──
        const headingText = (heading.textContent || '').trim();
        const chapterLabel = extractChapterLabel(headingText);
        const character = extractCharacterFromChapterTitle(headingText);
        const house = character ? getHouseForCharacter(character) : null;

        // Wrap heading + ornament line in a GOT header container
        const gotHeader = doc.createElement('div');
        gotHeader.className = CITADEL_GOT_HEADER_CLASS;

        // Inject chapter label above heading if present in original text
        if (chapterLabel) {
          const labelEl = doc.createElement('div');
          labelEl.textContent = chapterLabel;
          labelEl.className = CITADEL_GOT_CHAPTER_LABEL_CLASS;
          gotHeader.appendChild(labelEl);
        }

        // Move heading into the GOT header container
        heading.parentNode?.insertBefore(gotHeader, heading);
        gotHeader.appendChild(heading);

        // Build ornament line: left line — sigil — right line
        if (house) {
          const lineWrap = doc.createElement('div');
          lineWrap.className = CITADEL_GOT_ORNAMENT_LINE_WRAP_CLASS;

          const leftLine = doc.createElement('div');
          leftLine.className = CITADEL_GOT_ORNAMENT_SIDE_CLASS;

          const sigilEl = doc.createElement('div');
          sigilEl.className = CITADEL_CHAPTER_SIGIL_CLASS;
          sigilEl.style.maskImage = `url(${house.sigilPath})`;
          sigilEl.style.webkitMaskImage = `url(${house.sigilPath})`;
          sigilEl.setAttribute('role', 'img');
          sigilEl.setAttribute('aria-label', `${house.name} sigil`);

          const rightLine = doc.createElement('div');
          rightLine.className = `${CITADEL_GOT_ORNAMENT_SIDE_CLASS} got-ornament-right`;

          lineWrap.appendChild(leftLine);
          lineWrap.appendChild(sigilEl);
          lineWrap.appendChild(rightLine);
          gotHeader.appendChild(lineWrap);
        }
      } else {
        // ── Non-GOT themed books: standard PNG ornament dividers ──
        const dividerSrc = getOrnamentAsset(theme.ornamentStyle, 'divider');
        if (dividerSrc) {
          const dividerAbove = doc.createElement('img');
          dividerAbove.src = dividerSrc;
          dividerAbove.alt = '';
          dividerAbove.className = `${CITADEL_ORNAMENT_DIVIDER_CLASS} ornament-divider-above`;
          dividerAbove.setAttribute('width', '160');
          dividerAbove.setAttribute('height', '22');
          heading.parentNode?.insertBefore(dividerAbove, heading);
        }

        if (dividerSrc) {
          const dividerBelow = doc.createElement('img');
          dividerBelow.src = dividerSrc;
          dividerBelow.alt = '';
          dividerBelow.className = `${CITADEL_ORNAMENT_DIVIDER_CLASS} ornament-divider-below`;
          dividerBelow.setAttribute('width', '120');
          dividerBelow.setAttribute('height', '22');
          heading.parentNode?.insertBefore(dividerBelow, heading.nextSibling);
        }
      }
    }

    const ornament = heading.previousElementSibling;
    if (ornament && isCitadelChapterOrnamentCandidate(ornament)) {
      ornament.classList.add(CITADEL_CHAPTER_ORNAMENT_CLASS);
    }
    paragraph.classList.add(CITADEL_DROP_CAP_CLASS);
  }

  // Page-corner ornaments are rendered on the React layer in BooksGrid.tsx
  // (sibling to the page well, z-[3]). The iframe-side injection below is kept
  // gated for parity but disabled to avoid two ornament systems competing.
  const RENDER_IFRAME_PAGE_CORNERS = false;
  if (RENDER_IFRAME_PAGE_CORNERS && theme && theme.id !== 'default') {
    const cornerSrc = getOrnamentAsset(theme.ornamentStyle, 'corner');
    if (cornerSrc) {
      const cornerPositions = [
        CITADEL_CORNER_TL_CLASS,
        CITADEL_CORNER_TR_CLASS,
        CITADEL_CORNER_BL_CLASS,
        CITADEL_CORNER_BR_CLASS,
      ];
      for (const pos of cornerPositions) {
        const corner = doc.createElement('img');
        corner.src = cornerSrc;
        corner.alt = '';
        corner.className = `${CITADEL_CORNER_ORNAMENT_CLASS} ${pos}`;
        doc.body?.appendChild(corner);
      }
    }
  }
};

const FoliateViewer: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  config: BookConfig;
  gridInsets: Insets;
  contentInsets: Insets;
}> = ({ bookKey, bookDoc, config, gridInsets, contentInsets: insets }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { themeCode, isDarkMode } = useThemeStore();
  const { settings } = useSettingsStore();
  const { loadFont, loadCustomFonts, getLoadedFonts, getAvailableFonts } = useCustomFontStore();
  const { getView, setView: setFoliateView, setViewInited, setProgress } = useReaderStore();
  const { getViewState, getProgress, getViewSettings, setViewSettings } = useReaderStore();
  const { getParallels } = useParallelViewStore();
  const { getBookData } = useBookDataStore();
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const bookData = getBookData(bookKey);
  const viewState = getViewState(bookKey);
  const viewSettings = getViewSettings(bookKey);

  const bookTheme = React.useMemo(() => {
    const book = bookData?.book;
    if (!book) return undefined;
    return resolveBookThemeFromBook(book);
  }, [bookData?.book]);

  const viewRef = useRef<FoliateView | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isViewCreated = useRef(false);
  const doubleClickDisabled = useRef(!!viewSettings?.disableDoubleClick);
  const [toastMessage, setToastMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [scrollMargins, setScrollMargins] = useState({ top: 0, bottom: 0 });
  const docLoaded = useRef(false);

  useAutoFocus<HTMLDivElement>({ ref: containerRef });

  useDiscordPresence(
    bookData?.book || null,
    !!viewState?.isPrimary,
    settings.discordRichPresenceEnabled,
  );

  useEffect(() => {
    const timer = setTimeout(() => setToastMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  useUICSS(bookKey);
  useProgressSync(bookKey);
  useProgressAutoSave(bookKey);
  useBookCoverAutoSave(bookKey);
  const { syncState, conflictDetails, resolveWithLocal, resolveWithRemote } = useKOSync(bookKey);
  useTextTranslation(bookKey, viewRef.current);

  const progressRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const atEnd = viewRef.current?.renderer.atEnd || false;
    const { current, next, total } = detail.location as PageInfo;
    const currentPage = atEnd && total > 0 ? total - 1 : current;
    const pageInfo = { current: currentPage, next, total };
    setProgress(
      bookKey,
      detail.cfi,
      detail.tocItem,
      detail.section,
      pageInfo,
      detail.time,
      detail.range,
    );
  };

  const getDocTransformHandler = ({ width, height }: { width: number; height: number }) => {
    return (event: Event) => {
      const { detail } = event as CustomEvent;
      detail.data = Promise.resolve(detail.data)
        .then((data) => {
          const viewSettings = getViewSettings(bookKey);
          const bookData = getBookData(bookKey);
          if (viewSettings && detail.type === 'text/css')
            return transformStylesheet(data, width, height, viewSettings.vertical);
          const isHtml = detail.type === 'application/xhtml+xml' || detail.type === 'text/html';
          if (viewSettings && bookData && isHtml) {
            const ctx: TransformContext = {
              bookKey,
              viewSettings,
              width,
              height,
              isFixedLayout: bookData.isFixedLayout,
              primaryLanguage: bookData.book?.primaryLanguage,
              userLocale: getLocale(),
              content: data,
              sectionHref: detail.name,
              transformers: [
                'style',
                'punctuation',
                'footnote',
                'whitespace',
                'language',
                'sanitizer',
                'simplecc',
                'proofread',
              ],
            };
            return Promise.resolve(transformContent(ctx));
          }
          return data;
        })
        .catch((e) => {
          console.error(new Error(`Failed to load ${detail.name}`, { cause: e }));
          return '';
        });
    };
  };

  const skipToReadingPosition = useCallback(() => {
    const view = getView(bookKey);
    const progress = getProgress(bookKey);
    if (view && progress) {
      view.renderer.scrollToAnchor?.(progress.range);
    }
  }, [getView, getProgress, bookKey]);

  const skipToNextSection = useCallback(() => {
    const view = getView(bookKey);
    const viewSettings = getViewSettings(bookKey);
    viewPagination(view, viewSettings, 'down', 'section');
  }, [bookKey]);

  const docLoadHandler = (event: Event) => {
    docLoaded.current = true;
    if (bookDoc.rendition?.layout === 'pre-paginated') {
      setLoading(false); // Fixed layout doesn't emit 'stabilized' event
    }
    const detail = (event as CustomEvent).detail;
    console.log('doc index loaded:', detail.index);
    if (detail.doc) {
      const renderer = viewRef.current?.renderer;
      const writingDir = renderer?.setStyles && getDirection(detail.doc);
      const viewSettings = getViewSettings(bookKey)!;
      const bookData = getBookData(bookKey)!;

      const newVertical =
        writingDir?.vertical || viewSettings.writingMode.includes('vertical') || false;
      const newRtl =
        writingDir?.rtl ||
        getDirFromUILanguage() === 'rtl' ||
        viewSettings.writingMode.includes('rl') ||
        false;
      if (viewSettings.vertical !== newVertical || viewSettings.rtl !== newRtl) {
        viewSettings.vertical = newVertical;
        viewSettings.rtl = newRtl;
        setViewSettings(bookKey, { ...viewSettings });
      }

      if (!bookData?.isFixedLayout) {
        mountAdditionalFonts(detail.doc, isCJKLang(bookData.book?.primaryLanguage));
      }

      getLoadedFonts().forEach((font) => {
        mountCustomFont(detail.doc, font);
      });

      if (bookDoc.rendition?.layout === 'pre-paginated') {
        applyFixedlayoutStyles(detail.doc, viewSettings);
        const themeCode = getThemeCode();
        if (bookData.book?.format === 'PDF' && themeCode && renderer) {
          renderer.pageColors = viewSettings.applyThemeToPDF
            ? {
                background: themeCode.bg,
                foreground: themeCode.fg,
              }
            : undefined;
        }
      }

      applyImageStyle(detail.doc);
      applyTableStyle(detail.doc);
      applyThemeModeClass(detail.doc, isDarkMode);
      applyScrollModeClass(detail.doc, viewSettings.scrolled || false);
      applyScrollbarStyle(document, viewSettings.hideScrollbar || false);
      keepTextAlignment(detail.doc);
      applyCitadelBookPageStyles(detail.doc, bookData.isFixedLayout, bookTheme);
      handleA11yNavigation(viewRef.current, detail.doc, {
        skipToLastPosCallback: skipToReadingPosition,
        skipToLastPosLabel: _('Skip to last reading position'),
        skipToNextSectionCallback: skipToNextSection,
        skipToNextSectionLabel: _('End of this section. Continue to the next.'),
      });

      // Inline scripts in tauri platforms are not executed by default
      if (viewSettings.allowScript && isTauriAppPlatform()) {
        evalInlineScripts(detail.doc);
      }

      // only call on load if we have highlighting turned on.
      if (viewSettings.codeHighlighting) {
        manageSyntaxHighlighting(detail.doc, viewSettings);
      }

      setTimeout(() => {
        const sectionIndex = detail.index;
        const booknotes = config.booknotes || [];
        booknotes
          .filter(
            (item) =>
              !item.deletedAt &&
              item.type === 'annotation' &&
              item.style &&
              getIndexFromCfi(item.cfi) === sectionIndex,
          )
          .map((annotation) => {
            try {
              viewRef.current?.addAnnotation(annotation);
            } catch (err) {
              console.warn('Failed to add annotation', { annotation, error: err });
            }
          });
      }, 100);

      if (!detail.doc.isEventListenersAdded) {
        // listened events in iframes are posted to the main window
        // and then used by useMouseEvent and useTouchEvent
        // and more gesture events can be detected in the iframeEventHandlers
        detail.doc.isEventListenersAdded = true;
        detail.doc.addEventListener('keydown', handleKeydown.bind(null, bookKey));
        detail.doc.addEventListener('keyup', handleKeyup.bind(null, bookKey));
        detail.doc.addEventListener('mousedown', handleMousedown.bind(null, bookKey));
        detail.doc.addEventListener('mouseup', handleMouseup.bind(null, bookKey));
        detail.doc.addEventListener('click', handleClick.bind(null, bookKey, doubleClickDisabled));
        detail.doc.addEventListener('wheel', handleWheel.bind(null, bookKey));
        detail.doc.addEventListener('touchstart', handleTouchStart.bind(null, bookKey));
        detail.doc.addEventListener('touchmove', handleTouchMove.bind(null, bookKey));
        detail.doc.addEventListener('touchend', handleTouchEnd.bind(null, bookKey));
        addLongPressListeners(bookKey, detail.doc);
      }
    }
  };

  const evalInlineScripts = (doc: Document) => {
    if (doc.defaultView && doc.defaultView.frameElement) {
      const iframe = doc.defaultView.frameElement as HTMLIFrameElement;
      const scripts = doc.querySelectorAll('script:not([src])');
      scripts.forEach((script, index) => {
        const scriptContent = script.textContent || script.innerHTML;
        try {
          console.warn('Evaluating inline scripts in iframe');
          iframe.contentWindow?.eval(scriptContent);
        } catch (error) {
          console.error(`Error executing iframe script ${index + 1}:`, error);
        }
      });
    }
  };

  const stabilizedHandler = useCallback(() => {
    setLoading(false);
  }, []);

  const docRelocateHandler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail.reason !== 'scroll' && detail.reason !== 'page') return;

    const parallelViews = getParallels(bookKey);
    if (parallelViews && parallelViews.size > 0) {
      parallelViews.forEach((key) => {
        if (key !== bookKey) {
          const target = getView(key)?.renderer;
          if (target) {
            target.goTo?.({ index: detail.index, anchor: detail.fraction });
          }
        }
      });
    }
  };

  const { handlePageFlip } = usePagination(bookKey, viewRef, containerRef);
  const mouseHandlers = useMouseEvent(bookKey, handlePageFlip);
  const touchHandlers = useTouchEvent(bookKey);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedTableHtml, setSelectedTableHtml] = useState<string | null>(null);
  const [imageList, setImageList] = useState<{ src: string; cfi: string | null }[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  const handleImagePress = useCallback(async (src: string) => {
    try {
      // Get all images from the current document
      const docs = viewRef.current?.renderer.getContents();
      const allImages: { src: string; cfi: string | null }[] = [];

      docs?.forEach(({ doc, index }) => {
        const elements = doc.querySelectorAll('img, svg');
        elements.forEach((el) => {
          if (index === undefined) return;
          if (el.localName === 'img') {
            const img = el as HTMLImageElement;
            if (img.src && img.parentNode) {
              const range = doc.createRange();
              range.selectNodeContents(img);
              const cfi = viewRef.current?.getCFI(index, range) || null;
              allImages.push({ src: img.src, cfi });
            }
          } else if (el.localName === 'svg') {
            const svg = el as unknown as SVGSVGElement;
            const svgImage = svg.querySelector('image');
            const href =
              svgImage?.getAttribute('href') ||
              svgImage?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (href) {
              const range = doc.createRange();
              range.selectNodeContents(svg);
              const cfi = viewRef.current?.getCFI(index, range) || null;
              allImages.push({ src: href, cfi });
            }
          }
        });
      });

      // Find the index of the pressed image
      const index = allImages.findIndex((img) => img.src === src);

      setImageList(allImages);
      setCurrentImageIndex(index >= 0 ? index : 0);

      const dataUrl = await convertBlobUrlToDataUrl(src);
      setSelectedImage(dataUrl);
    } catch (error) {
      console.error('Failed to load image:', error);
    }
  }, []);

  const handleTablePress = useCallback((html: string) => {
    setSelectedTableHtml(html);
  }, []);

  const handlePreviousImage = useCallback(async () => {
    if (currentImageIndex > 0 && imageList.length > 0) {
      const newIndex = currentImageIndex - 1;
      setCurrentImageIndex(newIndex);
      try {
        const { src, cfi } = imageList[newIndex]!;
        const dataUrl = await convertBlobUrlToDataUrl(src);
        setSelectedImage(dataUrl);
        if (cfi && viewRef.current) {
          viewRef.current?.goTo(cfi);
        }
      } catch (error) {
        console.error('Failed to load previous image:', error);
      }
    }
  }, [currentImageIndex, imageList]);

  const handleNextImage = useCallback(async () => {
    if (currentImageIndex < imageList.length - 1 && imageList.length > 0) {
      const newIndex = currentImageIndex + 1;
      setCurrentImageIndex(newIndex);
      try {
        const { src, cfi } = imageList[newIndex]!;
        const dataUrl = await convertBlobUrlToDataUrl(src);
        setSelectedImage(dataUrl);
        if (cfi && viewRef.current) {
          viewRef.current?.goTo(cfi);
        }
      } catch (error) {
        console.error('Failed to load next image:', error);
      }
    }
  }, [currentImageIndex, imageList]);

  const handleCloseImage = useCallback(() => {
    setSelectedImage(null);
    setImageList([]);
    setCurrentImageIndex(0);
  }, []);

  useLongPressEvent(bookKey, handleImagePress, handleTablePress);

  useFoliateEvents(viewRef.current, {
    onLoad: docLoadHandler,
    onStabilized: stabilizedHandler,
    onRelocate: progressRelocateHandler,
    onRendererRelocate: docRelocateHandler,
  });

  useEffect(() => {
    if (isViewCreated.current) return;
    isViewCreated.current = true;

    setTimeout(() => setLoading(true), 200);

    const openBook = async () => {
      console.log('Opening book', bookKey);
      await import('foliate-js/view.js');
      const view = wrappedFoliateView(document.createElement('foliate-view') as FoliateView);
      view.id = `foliate-view-${bookKey}`;
      containerRef.current?.appendChild(view);

      const viewSettings = getViewSettings(bookKey)!;
      const writingMode = viewSettings.writingMode;
      if (writingMode) {
        const settingsDir = getBookDirFromWritingMode(writingMode);
        const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);
        if (settingsDir !== 'auto') {
          bookDoc.dir = settingsDir;
        } else if (languageDir !== 'auto') {
          bookDoc.dir = languageDir;
        }
      }

      if (bookDoc.rendition?.layout === 'pre-paginated' && bookDoc.sections) {
        bookDoc.rendition.spread = viewSettings.spreadMode;
        const coverSide = bookDoc.dir === 'rtl' ? 'right' : 'left';
        bookDoc.sections[0]!.pageSpread = viewSettings.keepCoverSpread ? '' : coverSide;
      }

      await view.open(bookDoc);
      // make sure we can listen renderer events after opening book
      viewRef.current = view;
      setFoliateView(bookKey, view);

      const { book } = view;

      book.transformTarget?.addEventListener('load', async (event: Event) => {
        const { detail } = event as CustomEvent<{
          isScript: boolean;
          type: string;
          href: string;
          url?: string;
          allow?: boolean;
        }>;
        if (detail.isScript) {
          detail.allow = viewSettings.allowScript ?? false;
        }
        if (isFontType(detail.type) && detail.href?.startsWith('fonts/')) {
          const fontFileName = detail.href.split('/').pop()?.toLowerCase();
          getAvailableFonts().forEach(async (font) => {
            const customFontFileName = font.path.split('/').pop()?.toLowerCase();
            if (fontFileName && fontFileName === customFontFileName) {
              if (!font.loaded) {
                const loadedFont = await loadFont(envConfig, font.id);
                font.blobUrl = loadedFont?.blobUrl;
              }
              if (font.blobUrl) {
                detail.url = font.blobUrl;
              }
            }
          });
        }
      });
      const viewWidth = appService?.isMobile ? screen.width : window.innerWidth;
      const viewHeight = appService?.isMobile ? screen.height : window.innerHeight;
      const width = viewWidth - insets.left - insets.right;
      const height = viewHeight - insets.top - insets.bottom;
      book.transformTarget?.addEventListener('data', getDocTransformHandler({ width, height }));
      view.renderer.setStyles?.(getStyles(viewSettings));
      applyTranslationStyle(viewSettings);

      doubleClickDisabled.current = viewSettings.disableDoubleClick!;
      const animated = viewSettings.animated!;
      const eink = viewSettings.isEink!;
      const maxColumnCount = viewSettings.maxColumnCount!;
      const maxInlineSize = getMaxInlineSize(viewSettings);
      const maxBlockSize = viewSettings.maxBlockSize!;
      const screenOrientation = viewSettings.screenOrientation!;
      if (appService?.isMobileApp) {
        await lockScreenOrientation({ orientation: screenOrientation });
      }
      if (animated) {
        view.renderer.setAttribute('animated', '');
      } else {
        view.renderer.removeAttribute('animated');
      }
      if (appService?.isAndroidApp) {
        if (eink) {
          view.renderer.setAttribute('eink', '');
        } else {
          view.renderer.removeAttribute('eink');
        }
        applyEinkMode(eink);
      }
      if (bookDoc?.rendition?.layout === 'pre-paginated') {
        view.renderer.setAttribute('zoom', viewSettings.zoomMode);
        view.renderer.setAttribute('spread', viewSettings.spreadMode);
        view.renderer.setAttribute('scale-factor', viewSettings.zoomLevel);
      } else {
        view.renderer.setAttribute('max-column-count', maxColumnCount);
        view.renderer.setAttribute('max-inline-size', `${maxInlineSize}px`);
        view.renderer.setAttribute('max-block-size', `${maxBlockSize}px`);
      }
      applyMarginAndGap();

      const lastLocation = config.location;
      if (lastLocation) {
        await view.init({ lastLocation });
      } else {
        await view.goToFraction(0);
      }
      setViewInited(bookKey, true);
    };

    openBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyMarginAndGap = () => {
    const viewSettings = getViewSettings(bookKey)!;
    const viewState = getViewState(bookKey);
    const viewInsets = getViewInsets(viewSettings);
    const showDoubleBorder = viewSettings.vertical && viewSettings.doubleBorder;
    const showDoubleBorderHeader = showDoubleBorder && viewSettings.showHeader;
    const showDoubleBorderFooter = showDoubleBorder && viewSettings.showFooter;
    const showTopHeader = viewSettings.showHeader && !viewSettings.vertical;
    const showBottomFooter = viewSettings.showFooter && !viewSettings.vertical;
    const moreTopInset = showTopHeader ? Math.max(0, 44 - insets.top) : 0;
    const ttsBarHeight =
      viewState?.ttsEnabled && viewSettings.showTTSBar ? 52 + gridInsets.bottom * 0.33 : 0;
    const moreBottomInset = showBottomFooter
      ? Math.max(0, Math.max(ttsBarHeight, 52) - insets.bottom)
      : Math.max(0, ttsBarHeight);
    const moreRightInset = showDoubleBorderHeader ? 32 : 0;
    const moreLeftInset = showDoubleBorderFooter ? 32 : 0;
    const topMargin = (showTopHeader ? insets.top : viewInsets.top) + moreTopInset;
    const rightMargin = insets.right + moreRightInset;
    const bottomMargin = (showBottomFooter ? insets.bottom : viewInsets.bottom) + moreBottomInset;
    const leftMargin = insets.left + moreLeftInset;
    const viewMargins = viewSettings.showMarginsOnScroll && viewSettings.scrolled;

    viewRef.current?.renderer.setAttribute('margin-top', `${viewMargins ? 0 : topMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-right', `${rightMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-bottom', `${viewMargins ? 0 : bottomMargin}px`);
    viewRef.current?.renderer.setAttribute('margin-left', `${leftMargin}px`);
    if (viewMargins) {
      const showBarsOnScroll = viewSettings.showBarsOnScroll;
      const headerVisible = showTopHeader && showBarsOnScroll;
      const footerVisible = showBottomFooter && showBarsOnScroll;
      const safeBottomPadding = appService?.hasSafeAreaInset ? gridInsets.bottom * 0.33 : 0;
      const footerBarHeight = 52 + safeBottomPadding;
      const scrollTop = headerVisible ? gridInsets.top + 44 : 0;
      const scrollBottom = footerVisible ? Math.max(footerBarHeight, ttsBarHeight) : ttsBarHeight;
      setScrollMargins({ top: scrollTop, bottom: scrollBottom });
    } else {
      setScrollMargins({ top: 0, bottom: 0 });
    }
    viewRef.current?.renderer.setAttribute('gap', `${viewSettings.gapPercent}%`);
    if (viewSettings.scrolled) {
      viewRef.current?.renderer.setAttribute('flow', 'scrolled');
      if (viewSettings.noContinuousScroll) {
        viewRef.current?.renderer.setAttribute('no-continuous-scroll', '');
      } else {
        viewRef.current?.renderer.removeAttribute('no-continuous-scroll');
      }
    }
  };

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer) {
      const renderer = viewRef.current.renderer;
      const viewSettings = getViewSettings(bookKey)!;
      viewRef.current.renderer.setStyles?.(getStyles(viewSettings));
      const docs = viewRef.current.renderer.getContents();
      docs.forEach(({ doc }) => {
        if (bookDoc.rendition?.layout === 'pre-paginated') {
          applyFixedlayoutStyles(doc, viewSettings);
        }
        applyThemeModeClass(doc, isDarkMode);
        applyScrollModeClass(doc, viewSettings.scrolled || false);
        applyScrollbarStyle(document, viewSettings.hideScrollbar || false);
        applyCitadelBookPageStyles(doc, bookData?.isFixedLayout, bookTheme);
      });

      if (bookData?.book?.format === 'PDF' && themeCode && renderer) {
        renderer.pageColors = viewSettings.applyThemeToPDF
          ? {
              background: themeCode.bg,
              foreground: themeCode.fg,
            }
          : undefined;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    themeCode,
    isDarkMode,
    bookTheme,
    viewSettings?.scrolled,
    viewSettings?.overrideColor,
    viewSettings?.invertImgColorInDark,
    viewSettings?.applyThemeToPDF,
    viewSettings?.hideScrollbar,
  ]);

  useEffect(() => {
    const mountCustomFonts = async () => {
      await loadCustomFonts(envConfig);
      getLoadedFonts().forEach((font) => {
        mountCustomFont(document, font);
        const docs = viewRef.current?.renderer.getContents();
        docs?.forEach(({ doc }) => mountCustomFont(doc, font));
      });
    };
    if (settings.customFonts) {
      mountCustomFonts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.customFonts, envConfig]);

  useEffect(() => {
    if (!viewSettings) return;
    applyBackgroundTexture(envConfig, viewSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewSettings?.backgroundTextureId,
    viewSettings?.backgroundOpacity,
    viewSettings?.backgroundSize,
    applyBackgroundTexture,
  ]);

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer) {
      doubleClickDisabled.current = !!viewSettings?.disableDoubleClick;
    }
  }, [viewSettings?.disableDoubleClick]);

  useEffect(() => {
    if (viewRef.current && viewRef.current.renderer && viewSettings) {
      applyMarginAndGap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    insets.top,
    insets.right,
    insets.bottom,
    insets.left,
    viewSettings?.doubleBorder,
    viewSettings?.showHeader,
    viewSettings?.showFooter,
    viewSettings?.showTTSBar,
    viewSettings?.showBarsOnScroll,
    viewSettings?.showMarginsOnScroll,
    viewSettings?.scrolled,
    viewSettings?.noContinuousScroll,
    viewState?.ttsEnabled,
  ]);

  return (
    <>
      {selectedImage && (
        <ImageViewer
          gridInsets={gridInsets}
          src={selectedImage}
          onClose={handleCloseImage}
          onPrevious={currentImageIndex > 0 ? handlePreviousImage : undefined}
          onNext={currentImageIndex < imageList.length - 1 ? handleNextImage : undefined}
        />
      )}
      {selectedTableHtml && (
        <TableViewer
          gridInsets={gridInsets}
          html={selectedTableHtml}
          isDarkMode={isDarkMode}
          onClose={() => setSelectedTableHtml(null)}
        />
      )}
      <div
        ref={containerRef}
        role='main'
        aria-label={_('Book Content')}
        className={clsx(
          'foliate-viewer absolute h-[100%] w-[100%] focus:outline-none',
          viewState?.loading && 'bg-base-100',
        )}
        style={{
          paddingTop: scrollMargins.top,
          paddingBottom: scrollMargins.bottom,
        }}
        {...mouseHandlers}
        {...touchHandlers}
      />
      <ParagraphControl bookKey={bookKey} viewRef={viewRef} gridInsets={gridInsets} />
      {((!docLoaded.current && loading) || viewState?.loading) && (
        <div className='absolute left-0 top-0 z-10 flex h-full w-full items-center justify-center'>
          <Spinner loading={true} />
        </div>
      )}
      {syncState === 'conflict' && conflictDetails && (
        <KOSyncConflictResolver
          details={conflictDetails}
          onResolveWithLocal={resolveWithLocal}
          onResolveWithRemote={resolveWithRemote}
          onClose={resolveWithLocal}
        />
      )}
    </>
  );
};

export default FoliateViewer;
