package com.readest.native_bridge

import android.util.Log
import android.view.ActionMode
import android.view.Menu
import android.view.MenuInflater
import android.view.View
import android.widget.PopupMenu

/**
 * Suppresses the system floating text-selection toolbar (Copy / Share /
 * Select all / Web search) so it can never cover Readest's own annotation
 * toolbar (#5427), mirroring the iOS ContextMenuSuppressor (#4218).
 *
 * Chromium presents and re-presents that toolbar through paths that never
 * fire a cancelable `contextmenu` DOM event — handle-drag adjustments
 * (MenuSourceType.ADJUST_SELECTION), restoreSelectionPopupsIfNecessary on
 * window focus regain, and TextClassifier callbacks in its
 * SelectionPopupControllerImpl — so the JS-level preventDefault in
 * useTextSelector cannot reliably block it (first reported on Pixel /
 * Android 17 / WebView 150). The
 * only stable seam left is `Activity.onWindowStartingActionMode`: while the
 * JS side keeps [suppressed] set, hand the framework a [NoOpActionMode] so no
 * FloatingToolbar UI is ever built.
 *
 * Returning null instead would NOT work: Chromium's SelectionPopupController
 * treats a failed ActionMode start as "selection UI unavailable" and clears
 * the selection, which would break selection entirely. The mode must exist —
 * it just draws nothing. Selection and drag handles stay fully functional.
 *
 * The JS side (useTextSelector) keeps the flag set exactly while reader text
 * is selected, so with no reader selection the system Cut/Copy/Paste menus in
 * app text fields keep working.
 */
object SelectionMenuSuppressor {
    @JvmStatic
    @Volatile
    var suppressed = false

    /**
     * Returns a UI-less ActionMode when suppression applies, or null to let
     * the framework present the mode normally.
     */
    @JvmStatic
    fun onWindowStartingActionMode(
        decorView: View?,
        callback: ActionMode.Callback?,
        type: Int,
    ): ActionMode? {
        if (!suppressed || type != ActionMode.TYPE_FLOATING) return null
        if (decorView == null || callback == null) return null
        Log.d("SelectionMenuSuppressor", "Suppressing floating selection ActionMode")
        return NoOpActionMode(decorView, callback)
    }

    /**
     * An ActionMode that renders nothing. It must still honor the ActionMode
     * contract: `finish()` notifies the callback (DecorView's wrapper), which
     * lets Chromium run `onDestroyActionMode` — deciding there whether to keep
     * or clear the selection — and lets DecorView drop its floating-mode
     * reference and fire `onActionModeFinished`.
     */
    private class NoOpActionMode(
        private val view: View,
        private val callback: ActionMode.Callback,
    ) : ActionMode() {
        // A real (never displayed) Menu so callers that inspect it don't
        // crash; PopupMenu is the only public factory for a Menu instance.
        private val noOpMenu: Menu = PopupMenu(view.context, view).menu
        private var finished = false

        init {
            type = ActionMode.TYPE_FLOATING
        }

        override fun setTitle(title: CharSequence?) {}

        override fun setTitle(resId: Int) {}

        override fun setSubtitle(subtitle: CharSequence?) {}

        override fun setSubtitle(resId: Int) {}

        override fun setCustomView(view: View?) {}

        // The menu is never shown, so skip the onPrepareActionMode round-trip
        // a real mode would make.
        override fun invalidate() {}

        override fun finish() {
            if (finished) return
            finished = true
            callback.onDestroyActionMode(this)
        }

        override fun getMenu(): Menu = noOpMenu

        override fun getTitle(): CharSequence? = null

        override fun getSubtitle(): CharSequence? = null

        override fun getCustomView(): View? = null

        override fun getMenuInflater(): MenuInflater = MenuInflater(view.context)
    }
}
