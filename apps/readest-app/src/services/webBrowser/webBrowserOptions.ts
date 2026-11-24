/**
 * Options handed to `open_web_browser` so the native / injected chrome
 * matches Readest's theme and UI language. Native code has no i18n: every
 * label it renders comes from here. Each `_()` call is a literal so the
 * i18next scanner extracts it (same pattern as `send/clipOptions.ts`).
 */

import { getThemeCode } from '@/utils/style';

type Translate = (key: string) => string;

export type WebBrowserLabelKey =
  | 'close'
  | 'clipPage'
  | 'selectImage'
  | 'imageSelectionHint'
  | 'imageSelectionUnavailable'
  | 'useImage'
  | 'cancel'
  | 'bookCover'
  | 'imageBrowseHint'
  | 'imageSelected'
  | 'imageConfirmHint'
  | 'chooseAnother'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'menu'
  | 'openInBrowser'
  | 'copyLink'
  | 'signOut'
  | 'notSecure'
  | 'downloading'
  | 'importing'
  | 'added'
  | 'failed'
  | 'unsupported'
  | 'open';

export interface WebBrowserOptions {
  /** `#rrggbb` — theme base-100. */
  background: string;
  /** `#rrggbb` — theme base-content. */
  foreground: string;
  isEink: boolean;
  direction?: 'ltr' | 'rtl';
  /** Browse normally until the user explicitly arms image selection. */
  selectImage?: boolean;
  labels: Record<WebBrowserLabelKey, string>;
}

export function getWebBrowserOptions(_: Translate, isEink: boolean): WebBrowserOptions {
  const { bg, fg } = getThemeCode();
  return {
    background: bg,
    foreground: fg,
    isEink,
    direction:
      typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
    labels: {
      close: _('Close'),
      clipPage: _('Clip Page'),
      selectImage: _('Choose cover'),
      imageSelectionHint: _('Choose an image on this page.'),
      imageSelectionUnavailable: _(
        'Open the full-size image preview, then choose the cover again.',
      ),
      useImage: _('Use this cover'),
      cancel: _('Cancel'),
      bookCover: _('Book cover'),
      imageBrowseHint: _('Browse for a cover, then choose it here.'),
      imageSelected: _('Cover selected'),
      imageConfirmHint: _('Use this image as the book cover?'),
      chooseAnother: _('Choose another'),
      back: _('Back'),
      forward: _('Forward'),
      reload: _('Reload'),
      stop: _('Stop'),
      menu: _('More'),
      openInBrowser: _('Open in Browser'),
      copyLink: _('Copy Link'),
      signOut: _('Sign out of this site'),
      notSecure: _('Not secure'),
      downloading: _('Downloading'),
      importing: _('Importing'),
      added: _('Added to library'),
      failed: _('Import failed'),
      unsupported: _('Not a supported book format'),
      open: _('Open'),
    },
  };
}
