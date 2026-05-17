/**
 * System (OS-native) dictionary bridge.
 *
 * Hands a word off to the platform's native dictionary surface:
 * - **macOS**: AppKit's `-[NSView showDefinitionForAttributedString:atPoint:]`
 *   is invoked through the `show_lookup_popover` Rust command in
 *   `src-tauri/src/macos/system_dictionary.rs`. Shows the inline
 *   "Look Up" HUD popover (the same surface as right-click → Look Up)
 *   without raising Dictionary.app to the foreground. Optionally
 *   anchored at the selection's bottom-center via {@link SystemDictionaryAnchor}.
 * - **iOS**: presents `UIReferenceLibraryViewController` modally via
 *   the native-bridge plugin's `show_lookup_popover` command (Swift
 *   side in `tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift`).
 *   This is the same controller UIKit uses for the Look Up callout in
 *   editable text views.
 * - **Android**: dispatches `Intent.ACTION_PROCESS_TEXT` through the
 *   native-bridge plugin (`tauri-plugin-native-bridge/android/.../NativeBridgePlugin.kt`).
 *   Any installed dictionary or translation app that registered the
 *   intent (ColorDict, GoldenDict, 欧路, Pleco, Google Translate, etc.)
 *   appears in the system chooser. When the user has no compatible
 *   app, the bridge returns `unavailable: true` and we resolve the
 *   handoff as `false` so the annotator just dismisses the popup
 *   silently — per the Q2 design decision.
 *
 * Web / Linux / Windows: the registry filter and the settings UI hide
 * the system-dictionary entry on these platforms, so the entry point
 * here should never be reached. We still return `false` defensively
 * rather than throwing — the worst case is a non-event from the user's
 * perspective.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';
import type { Rect } from '@/utils/sel';

/**
 * Optional positional hint for the lookup HUD (macOS only). When
 * provided, the macOS bridge anchors the popover near the selection's
 * bottom-center (in webview-viewport CSS pixels). Without it, the HUD
 * is centered in the window's contentView. iOS and Android ignore
 * this — their native UIs handle their own placement.
 */
export interface SystemDictionaryAnchor {
  /** Selection rect in the webview's viewport (CSS pixels, top-down). */
  rect: Rect;
  /**
   * Optional text style sampled from the original selection. Forwarded
   * to AppKit so the small HUD label that
   * `-[NSView showDefinitionForAttributedString:atPoint:]` re-renders
   * matches the underlying paragraph's font/color (right-click → Look
   * Up has the same look because it shares the host text view's
   * attributes; we have to ship them across explicitly because our
   * "host view" is a WKWebView).
   */
  style?: SystemDictionaryAnchorStyle;
}

export interface SystemDictionaryAnchorStyle {
  /** Font size in CSS pixels of the outer webview viewport. */
  fontSize?: number;
  /** Comma-separated CSS font-family stack. */
  fontFamily?: string;
  /** Foreground color in any CSS color form (e.g. `rgb(0, 0, 0)`). */
  color?: string;
}

/**
 * Platforms where the system-dictionary handoff is implemented. The
 * settings UI uses this to gate visibility of the "System Dictionary"
 * row, and the registry uses it to filter the provider out of the
 * popup tab list on unsupported hosts.
 */
export const isSystemDictionarySupported = (): boolean => {
  if (!isTauriAppPlatform()) return false;
  const os = typeof navigator !== 'undefined' ? getOSPlatform() : 'unknown';
  return os === 'macos' || os === 'ios' || os === 'android';
};

/**
 * Returns true when the platform's system-dictionary handoff is
 * actually wired up end-to-end. Now that all three native targets are
 * implemented, this matches {@link isSystemDictionarySupported}; it
 * stays as a separate function so the settings UI can grow a
 * "available but no dictionary app installed" state in the future
 * without having to change call sites.
 */
export const isSystemDictionaryAvailable = (): boolean => isSystemDictionarySupported();

/** Wire shape for the Android/iOS native-bridge `show_lookup_popover` command. */
interface MobileLookupResponse {
  success: boolean;
  /** Android: true when no app responded to ACTION_PROCESS_TEXT. */
  unavailable?: boolean;
  error?: string;
}

/**
 * Invoke the platform's native dictionary for `word`. Returns `true`
 * when the OS handoff was dispatched (the OS is responsible for the
 * "not found" UI from there); `false` when the platform is not yet
 * supported, no dictionary app is installed (Android), or the handoff
 * failed at the JS bridge level.
 *
 * Per the Q2 design decision, callers treat `false` as silent failure
 * — the system-dictionary path is opt-in, so a no-op is acceptable
 * recovery rather than an in-app fallback (which would defeat the
 * "exclusive" semantics of the setting).
 */
export const invokeSystemDictionary = async (
  word: string,
  anchor?: SystemDictionaryAnchor,
): Promise<boolean> => {
  const trimmed = word.trim();
  if (!trimmed) return false;
  if (!isTauriAppPlatform()) return false;

  const os = getOSPlatform();
  try {
    if (os === 'macos') {
      // Calls the Rust `show_lookup_popover` command in
      // `src-tauri/src/macos/system_dictionary.rs`, which calls
      // AppKit's `-[NSView showDefinitionForAttributedString:atPoint:]`
      // on the current window's contentView. The system shows its
      // inline HUD popover (same as right-click → Look Up) —
      // Dictionary.app stays in the background.
      const windowLabel = getCurrentWindow().label;
      let anchorPayload:
        | {
            x: number;
            y: number;
            scale: number;
            fontSize?: number;
            fontFamily?: string;
            color?: string;
          }
        | undefined;
      if (anchor) {
        const { rect, style } = anchor;
        // AppKit interprets `atPoint` as the BOTTOM-LEFT BASELINE of
        // the small label it re-draws using the supplied attributed
        // string. `rect.bottom` from `getBoundingClientRect()` is the
        // inline box's bottom edge, which sits a descender below the
        // baseline. Without compensating, the HUD label drifts down
        // by ~0.2 × fontSize relative to the original word. Subtract
        // an estimated descender so the re-drawn label's baseline
        // lines up with the original paragraph's baseline. 0.2 is the
        // typical descender ratio for Latin fonts and a reasonable
        // catch-all for the CJK-leaning fonts foliate ships with.
        const descender = (style?.fontSize ?? 0) * 0.2;
        anchorPayload = {
          x: rect.left,
          y: rect.bottom - descender,
          scale:
            typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
              ? window.devicePixelRatio || 1
              : 1,
          fontSize: style?.fontSize,
          fontFamily: style?.fontFamily,
          color: style?.color,
        };
      }
      await invoke('show_lookup_popover', {
        word: trimmed,
        windowLabel,
        anchor: anchorPayload,
      });
      return true;
    }
    if (os === 'ios' || os === 'android') {
      // Both mobile targets share the same plugin command name on the
      // native-bridge plugin. iOS presents `UIReferenceLibraryViewController`
      // modally; Android dispatches `ACTION_PROCESS_TEXT` to the user's
      // installed dictionary app(s) via a chooser. Anchor coordinates
      // are not forwarded — neither platform's native UI uses them.
      const result = await invoke<MobileLookupResponse>(
        'plugin:native-bridge|show_lookup_popover',
        { payload: { word: trimmed } },
      );
      // Android-only: chooser empty → no dictionary app installed.
      // Treat as silent no-op rather than an error per Q2 semantics.
      if (result?.unavailable) {
        console.info('[systemDictionary] no dictionary app installed for ACTION_PROCESS_TEXT');
        return false;
      }
      return result?.success === true;
    }
    return false;
  } catch (error) {
    console.warn('[systemDictionary] handoff failed', error);
    return false;
  }
};
