package com.readest.native_bridge

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for [decideLookupDispatch] — the browser-exclusion routing
 * for dictionary lookups (issue #4559). Runs on the host JVM; no Android
 * framework or device required.
 */
class LookupDispatchTest {
    private val eudic = LookupHandler("com.eusoft.eudic", ".LookupActivity")
    private val goldendict = LookupHandler("org.goldendict.android", ".MainActivity")
    private val vivoBrowser = LookupHandler("com.vivo.browser", ".BrowserActivity")
    private val browsers = setOf("com.vivo.browser", "com.android.chrome")

    @Test
    fun noHandlers_isUnavailable() {
        assertEquals(
            LookupDispatch.Unavailable,
            decideLookupDispatch(emptyList(), browsers, remembered = null),
        )
    }

    @Test
    fun noBrowserPresent_dispatchesImplicitly() {
        // Two dictionaries, no browser hijacking: leave it to the OS
        // (preserves the native "Just once / Always" behavior).
        assertEquals(
            LookupDispatch.DispatchImplicit,
            decideLookupDispatch(listOf(eudic, goldendict), browsers, remembered = null),
        )
    }

    @Test
    fun browserOnly_isUnavailable() {
        // The VIVO case with no dictionary installed: don't dump the user
        // into the browser — report unavailable so the TS layer hints.
        assertEquals(
            LookupDispatch.Unavailable,
            decideLookupDispatch(listOf(vivoBrowser), browsers, remembered = null),
        )
    }

    @Test
    fun browserPlusOneDictionary_launchesDictionaryDirectly() {
        assertEquals(
            LookupDispatch.DispatchExplicit(eudic),
            decideLookupDispatch(listOf(vivoBrowser, eudic), browsers, remembered = null),
        )
    }

    @Test
    fun browserPlusTwoDictionaries_noMemory_choosesExcludingBrowser() {
        assertEquals(
            LookupDispatch.DispatchChooser(listOf(vivoBrowser)),
            decideLookupDispatch(
                listOf(vivoBrowser, eudic, goldendict),
                browsers,
                remembered = null,
            ),
        )
    }

    @Test
    fun browserPlusTwoDictionaries_validMemory_launchesRememberedDirectly() {
        assertEquals(
            LookupDispatch.DispatchExplicit(goldendict),
            decideLookupDispatch(
                listOf(vivoBrowser, eudic, goldendict),
                browsers,
                remembered = goldendict,
            ),
        )
    }

    @Test
    fun browserPlusTwoDictionaries_staleMemory_fallsBackToChooser() {
        // Remembered app is no longer among the live handlers (uninstalled
        // / stopped registering) → ignore it and re-prompt.
        val stale = LookupHandler("com.removed.dict", ".Main")
        assertEquals(
            LookupDispatch.DispatchChooser(listOf(vivoBrowser)),
            decideLookupDispatch(
                listOf(vivoBrowser, eudic, goldendict),
                browsers,
                remembered = stale,
            ),
        )
    }
}
