package com.readest.native_bridge

import android.util.Log
import android.view.View

/**
 * Best-effort, device-agnostic deep e-ink full refresh (GC / GC16 waveform)
 * used to clear screen ghosting on demand.
 *
 * Android exposes no public e-ink API; every vendor patches its own methods
 * into the platform `android.view.View` (or ships a private SDK). We probe
 * each known framework mechanism via reflection in turn and stop at the first
 * that succeeds, so one call works across Onyx BOOX (Qualcomm), Tolino / Nook
 * (NTX / Freescale) and Boyue-style Rockchip devices without compiling against
 * any vendor SDK. Reflection targets are adapted from KOReader's EPD
 * controllers (koreader/android-luajit-launcher).
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
            rockchipRefresh(view)
    }

    // Onyx BOOX (Qualcomm models): `refreshScreen` is an instance method patched
    // onto View that performs an EPD update of the given region.
    private fun onyxRefresh(view: View, width: Int, height: Int): Boolean {
        return try {
            View::class.java
                .getMethod(
                    "refreshScreen",
                    Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE,
                )
                .invoke(view, 0, 0, width, height, ONYX_FULL_GC16)
            Log.i(TAG, "onyx full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "onyx refresh unavailable: ${e.message}")
            false
        }
    }

    // NTX / Freescale (Tolino, Nook): the thread-safe postInvalidateDelayed
    // overload that carries an e-ink waveform mode.
    private fun ntxRefresh(view: View, width: Int, height: Int): Boolean {
        return try {
            View::class.java
                .getMethod(
                    "postInvalidateDelayed",
                    java.lang.Long.TYPE,
                    Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE, Integer.TYPE,
                )
                .invoke(view, 0L, 0, 0, width, height, NTX_FULL_GC16)
            Log.i(TAG, "ntx full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "ntx refresh unavailable: ${e.message}")
            false
        }
    }

    // Rockchip (Boyue T61/T62 clones): View.requestEpdMode(View$EINK_MODE, boolean)
    // with the EPD_FULL enum constant.
    private fun rockchipRefresh(view: View): Boolean {
        return try {
            @Suppress("UNCHECKED_CAST")
            val einkEnum = Class.forName("android.view.View\$EINK_MODE") as Class<out Enum<*>>
            val full = einkEnum.enumConstants?.firstOrNull { it.name == "EPD_FULL" } ?: return false
            View::class.java
                .getMethod("requestEpdMode", einkEnum, java.lang.Boolean.TYPE)
                .invoke(view, full, true)
            Log.i(TAG, "rockchip full refresh requested")
            true
        } catch (e: Throwable) {
            Log.d(TAG, "rockchip refresh unavailable: ${e.message}")
            false
        }
    }
}
