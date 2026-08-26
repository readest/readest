package com.readest.native_bridge

import com.android.billingclient.BuildConfig
import org.junit.Assert.assertTrue
import org.junit.Test

class BillingLibraryVersionTest {
    @Test
    fun usesPlayBillingLibraryNineOrNewer() {
        val majorVersion = BuildConfig.VERSION_NAME.substringBefore('.').toInt()

        assertTrue(
            "Google Play Billing Library 9+ required, found ${BuildConfig.VERSION_NAME}",
            majorVersion >= 9
        )
    }
}
