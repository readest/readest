// `interactive-widget=resizes-content` makes Android Chrome shrink the
// layout viewport when the on-screen keyboard opens, matching iOS
// default behavior so `fixed inset-0`-centered modals (passphrase
// prompt, group picker, etc.) sit above the keyboard. Other browsers
// (Safari on macOS/iOS, desktop Chrome, Firefox) emit a console warning
// when they encounter the unrecognized key on every page load — so we
// only attach it on Android.
export const getAndroidPatchedViewportContent = (
  userAgent: string,
  currentContent: string,
): string | null => {
  if (!/android/i.test(userAgent)) return null;
  if (currentContent.includes('interactive-widget=')) return null;
  const trimmed = currentContent.trim().replace(/,\s*$/, '');
  if (!trimmed) return 'interactive-widget=resizes-content';
  return `${trimmed}, interactive-widget=resizes-content`;
};
