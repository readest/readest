import { isTauriAppPlatform } from '@/services/environment';

/**
 * Write `text` to the system clipboard.
 *
 * Why this wrapper exists:
 *   On Android (Tauri WebView) `navigator.clipboard.writeText` does not
 *   reliably write to the OS clipboard — selecting text inside a Reader
 *   iframe and tapping the in-app Copy button silently no-ops. Routing
 *   through the Tauri `clipboard-manager` plugin uses the Android
 *   `ClipboardManager` API directly and works in every Tauri target
 *   (Android, iOS, macOS, Windows, Linux). On the web build we keep the
 *   standard `navigator.clipboard` path with an `execCommand('copy')`
 *   fallback for older browsers / non-secure contexts.
 *
 * Resolves to `true` when the write succeeded, `false` otherwise.
 */
export const writeTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof text !== 'string') return false;

  if (isTauriAppPlatform()) {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(text);
      return true;
    } catch (err) {
      // Fall through to web APIs below — better to silently degrade than
      // to lose the user's copy entirely if the plugin is unavailable.
      console.warn('[clipboard] tauri writeText failed, falling back', err);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('[clipboard] navigator.clipboard.writeText failed, falling back', err);
    }
  }

  // Last-resort fallback for non-secure contexts / older WebViews.
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      console.warn('[clipboard] execCommand fallback failed', err);
    }
  }

  return false;
};
