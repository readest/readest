package com.readest.native_bridge

import android.content.Context
import android.util.Log
import android.view.View
import java.lang.reflect.Method

/**
 * Best-effort, device-agnostic deep e-ink full refresh (GC / GC16 waveform)
 * used to clear screen ghosting on demand.
 *
 * Android exposes no public e-ink API; every vendor patches its own methods
 * into the platform `android.view.View` (or ships a private SDK). We probe
 * each known framework mechanism via reflection in turn and stop at the first
 * that succeeds, so one call works across Onyx BOOX (Qualcomm), Tolino / Nook
 * (NTX / Freescale), Boyue-style Rockchip devices and Hanvon readers without
 * compiling against any vendor SDK. Reflection targets are adapted from
 * KOReader's EPD controllers (koreader/android-luajit-launcher).
 *
 * Unlike a reader that owns the whole update loop, Readest leaves the device's
 * automatic e-ink handling in place, so we deliberately do NOT switch the panel
 * into a manual update mode (e.g. Onyx `setWaveformAndScheme`) — that could
 * freeze subsequent system updates. We only request a one-shot full update.
 */
object EinkRefreshController {
    private const val TAG = "EinkRefresh"

    // android.view.View.refreshScreen(...) waveform mode (Onyx / Qualcomm):
    // EINK_WAVEFORM_UPDATE_FULL (32) + EINK_WAVEFORM_MODE_GC16 (2) = 34.
    private const val ONYX_FULL_GC16 = 34

    // android.view.View.postInvalidateDelayed(...) e-ink mode (NTX / Freescale):
    // EINK_UPDATE_MODE_FULL (32) + EINK_WAVEFORM_MODE_GC16 (2) = 34.
    private const val NTX_FULL_GC16 = 34

    // The vendor hooks, resolved via class-level reflection and cached. A
    // missing method/class (NoSuchMethod / ClassNotFound) is a definitive "not
    // here" and is cached as null; a hard reflection/linkage failure is left
    // uncached (these blocks catch only `Exception`, not `Error`) so a later
    // probe can retry it and an inconclusive first read is never mistaken for a
    // confirmed negative. `getMethod` / `Class.forName` only read the framework's
    // method table; they neither invoke the mechanism nor flash the panel, so
    // resolving them is a safe capability probe. [refresh] and [isSupported]
    // share these handles, so the UI is offered only where a vendor full-refresh
    // hook is present — a best-effort signal: a stubbed or hidden-API hook could
    // still be present yet fail at [refresh] time, which then reports
    // `success: false`.
    private val onyxRefreshScreen: Method? by lazy {
        try {
            View::class.java.getMethod(
                "refreshScreen",
                Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE,
            )
        } catch (e: Exception) {
            Log.d(TAG, "onyx refresh unavailable: ${e.message}")
            null
        }
    }

    private val ntxPostInvalidateDelayed: Method? by lazy {
        try {
            View::class.java.getMethod(
                "postInvalidateDelayed",
                java.lang.Long.TYPE,
                Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE,
            )
        } catch (e: Exception) {
            Log.d(TAG, "ntx refresh unavailable: ${e.message}")
            null
        }
    }

    private val rockchipRequestEpdMode: Pair<Method, Enum<*>>? by lazy {
        try {
            @Suppress("UNCHECKED_CAST")
            val einkEnum = Class.forName("android.view.View\$EINK_MODE") as Class<out Enum<*>>
            val full = einkEnum.enumConstants?.firstOrNull { it.name == "EPD_FULL" }
            if (full == null) {
                null
            } else {
                View::class.java.getMethod("requestEpdMode", einkEnum, java.lang.Boolean.TYPE) to full
            }
        } catch (e: Exception) {
            Log.d(TAG, "rockchip refresh unavailable: ${e.message}")
            null
        }
    }

    /**
     * Whether this device exposes at least one known full-refresh mechanism.
     * Drives the "Auto Full Refresh" UI: the option is only offered where a
     * deep refresh is actually possible, so it never misleads owners of panels
     * we cannot drive. Pure reflection — never touches the panel. May propagate
     * a hard reflection/linkage [Error] (an inconclusive read), which the
     * command layer turns into a retryable rejection rather than a false.
     */
    fun isSupported(): Boolean =
        onyxRefreshScreen != null || ntxPostInvalidateDelayed != null || rockchipRequestEpdMode != null

    /**
     * Attempt a deep full refresh over [view]'s region. Returns true when a
     * vendor mechanism accepted the request, false when none is available
     * (e.g. a non-e-ink Android phone). Never throws.
     */
    fun refresh(view: View): Boolean {
        val width = view.width
        val height = view.height
        if (width <= 0 || height <= 0) return false
        return onyxRefresh(view, width, height) ||
            ntxRefresh(view, width, height) ||
            rockchipRefresh(view) ||
            hanvonRefresh(view.context)
    }

    // Onyx BOOX (Qualcomm models): `refreshScreen` is an instance method patched
    // onto View that performs an EPD update of the given region.
    private fun onyxRefresh(view: View, width: Int, height: Int): Boolean {
        return try {
            val method = onyxRefreshScreen ?: return false
            method.invoke(view, 0, 0, width, height, ONYX_FULL_GC16)
            Log.i(TAG, "onyx full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "onyx refresh failed: ${e.message}")
            false
        }
    }

    // NTX / Freescale (Tolino, Nook): the thread-safe postInvalidateDelayed
    // overload that carries an e-ink waveform mode.
    private fun ntxRefresh(view: View, width: Int, height: Int): Boolean {
        return try {
            val method = ntxPostInvalidateDelayed ?: return false
            method.invoke(view, 0L, 0, 0, width, height, NTX_FULL_GC16)
            Log.i(TAG, "ntx full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "ntx refresh failed: ${e.message}")
            false
        }
    }

    // Rockchip (Boyue T61/T62 clones): View.requestEpdMode(View$EINK_MODE, boolean)
    // with the EPD_FULL enum constant.
    private fun rockchipRefresh(view: View): Boolean {
        return try {
            val resolved = rockchipRequestEpdMode ?: return false
            resolved.first.invoke(view, resolved.second, true)
            Log.i(TAG, "rockchip full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "rockchip refresh failed: ${e.message}")
            false
        }
    }

    // Hanvon readers: instead of patching View they register an "eink" system
    // service (a hidden android.os.EinkManager) whose sendOneFullFrame() performs
    // a one-shot full-panel update, the same call the stock readers use.
    private fun hanvonRefresh(context: Context): Boolean {
        return try {
            val einkManager = context.getSystemService("eink") ?: return false
            einkManager.javaClass.getMethod("sendOneFullFrame").invoke(einkManager)
            Log.i(TAG, "hanvon full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "hanvon refresh unavailable: ${e.message}")
            false
        }
    }
}
