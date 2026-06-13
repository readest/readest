package com.readest.native_bridge

/**
 * Pure decision logic for routing a dictionary `ACTION_PROCESS_TEXT`
 * lookup, factored out of [NativeBridgePlugin.show_lookup_popover] so it
 * can be unit-tested without an Android framework or device.
 *
 * The problem this solves (issue #4559): on some OEM ROMs (VIVO / iQOO
 * OriginOS) the system browser registers an activity for
 * `ACTION_PROCESS_TEXT` and is the system default, so a plain
 * `startActivity` hands the selected word to the browser instead of a
 * dictionary app. A web browser handling "process text" is never what a
 * "dictionary lookup" wants, so we filter browsers out of the handler
 * set and route to a real dictionary instead.
 */

/** A resolved `ACTION_PROCESS_TEXT` handler activity. */
data class LookupHandler(val packageName: String, val className: String)

/** How [NativeBridgePlugin.show_lookup_popover] should dispatch the intent. */
sealed class LookupDispatch {
    /** No app handles the lookup (or only browsers do) — surface the "no dictionary app" hint. */
    object Unavailable : LookupDispatch()

    /**
     * No browser is hijacking the intent — dispatch implicitly and let
     * the OS do exactly what it does today (single handler goes straight
     * through; multiple handlers show the system disambiguation dialog
     * with its native "Just once / Always" buttons).
     */
    object DispatchImplicit : LookupDispatch()

    /** Exactly one dictionary remains (or one was remembered) — launch it directly. */
    data class DispatchExplicit(val handler: LookupHandler) : LookupDispatch()

    /**
     * Several dictionaries remain behind a browser default — show a
     * chooser that excludes [exclude] (the browser handlers) so the
     * browser can't be picked, and remember whatever the user taps.
     */
    data class DispatchChooser(val exclude: List<LookupHandler>) : LookupDispatch()
}

/**
 * Decide how to dispatch the lookup.
 *
 * @param handlers every activity that resolves `ACTION_PROCESS_TEXT` for the word.
 * @param browserPackages package names of installed web browsers (apps that
 *   handle an `https` `ACTION_VIEW` + `CATEGORY_BROWSABLE` intent).
 * @param remembered a dictionary the user previously chose from the
 *   browser-excluding chooser, or `null`. Honored only if it still appears
 *   among [handlers] as a non-browser handler.
 */
fun decideLookupDispatch(
    handlers: List<LookupHandler>,
    browserPackages: Set<String>,
    remembered: LookupHandler?,
): LookupDispatch {
    if (handlers.isEmpty()) return LookupDispatch.Unavailable

    val browsers = handlers.filter { it.packageName in browserPackages }
    val dictionaries = handlers.filter { it.packageName !in browserPackages }

    // No browser among the handlers: nothing to filter out, so preserve
    // the existing system-driven behavior (incl. the native "Always"
    // affordance) untouched.
    if (browsers.isEmpty()) return LookupDispatch.DispatchImplicit

    return when (dictionaries.size) {
        0 -> LookupDispatch.Unavailable
        1 -> LookupDispatch.DispatchExplicit(dictionaries[0])
        else -> {
            // A remembered dictionary is only valid if it still resolves
            // the intent (the app could have been uninstalled or stopped
            // registering ACTION_PROCESS_TEXT).
            val saved = remembered?.takeIf { it in dictionaries }
            if (saved != null) LookupDispatch.DispatchExplicit(saved)
            else LookupDispatch.DispatchChooser(browsers)
        }
    }
}
