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
  labels: Record<WebBrowserLabelKey, string>;
}

export function getWebBrowserOptions(_: Translate, isEink: boolean): WebBrowserOptions {
  const { bg, fg } = getThemeCode();
  return {
    background: bg,
    foreground: fg,
    isEink,
    labels: {
      close: _('Close'),
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
