package com.readest.native_bridge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubscriptionReplacementTest {
    @Test
    fun switchingBillingPeriodReplacesTheExistingSubscription() {
        // Without the old purchase token Play starts a *second* subscription
        // and bills the user for both the monthly and the yearly plan.
        assertTrue(
            shouldReplaceSubscription(
                existingProductIds = listOf("com.bilingify.readest.monthly.plus"),
                newProductId = "com.bilingify.readest.yearly.plus",
            )
        )
    }

    @Test
    fun upgradingTierReplacesTheExistingSubscription() {
        assertTrue(
            shouldReplaceSubscription(
                existingProductIds = listOf("com.bilingify.readest.monthly.plus"),
                newProductId = "com.bilingify.readest.monthly.pro",
            )
        )
    }

    @Test
    fun repurchasingTheSameProductIsNotAReplacement() {
        assertFalse(
            shouldReplaceSubscription(
                existingProductIds = listOf("com.bilingify.readest.yearly.pro"),
                newProductId = "com.bilingify.readest.yearly.pro",
            )
        )
    }

    @Test
    fun firstSubscriptionIsNotAReplacement() {
        assertFalse(
            shouldReplaceSubscription(
                existingProductIds = emptyList(),
                newProductId = "com.bilingify.readest.yearly.plus",
            )
        )
    }
}
