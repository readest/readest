/**
 * Options handed to the Rust `clip_url` command so the in-webview
 * loading overlay, window title, "Saved" page, and native window
 * background all match Readest's current theme + UI language.
 *
 * Each `_()` call is a literal string so the i18next scanner can
 * extract the keys — keep them inline here rather than building from
 * dynamic input. The theme `bg`/`fg` come from the same
 * `getThemeCode()` that paints the rest of the app, so a user on
 * light, dark, eink, or a custom palette sees the same chrome in the
 * clipper window.
 */

import { getThemeCode } from '@/utils/style';

type Translate = (key: string) => string;

export interface ClipOptions {
  windowTitle: string;
  overlayTitle: string;
  loadingStatus: string;
  capturingStatus: string;
  savedTitle: string;
  background: string;
  foreground: string;
}

export function getClipOptions(_: Translate): ClipOptions {
  const { bg, fg } = getThemeCode();
  return {
    windowTitle: _('Saving to your Readest library…'),
    overlayTitle: _('Saving to Readest'),
    loadingStatus: _('Loading article…'),
    capturingStatus: _('Capturing article…'),
    savedTitle: _('Saved to Readest'),
    background: bg,
    foreground: fg,
  };
}
