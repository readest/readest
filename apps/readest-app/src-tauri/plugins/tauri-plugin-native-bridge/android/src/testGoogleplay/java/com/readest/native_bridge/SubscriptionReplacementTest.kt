package com.readest.native_bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SubscriptionReplacementTest {
    private fun sub(
        productId: String,
        token: String = "token-$productId",
        purchaseTimeMillis: Long = 0L,
        isPurchased: Boolean = true,
    ) = ExistingSubscription(
        productIds = listOf(productId),
        purchaseToken = token,
        purchaseTimeMillis = purchaseTimeMillis,
        isPurchased = isPurchased,
    )

    @Test
    fun switchingBillingPeriodReplacesTheExistingSubscription() {
        // Without the old purchase token Play starts a *second* subscription
        // and bills the user for both the monthly and the yearly plan.
        val result = resolveSubscriptionReplacement(
            existing = listOf(sub("com.bilingify.readest.monthly.plus")),
            newProductId = "com.bilingify.readest.yearly.plus",
        )

        val replace = result as SubscriptionReplacement.Replace
        assertEquals("token-com.bilingify.readest.monthly.plus", replace.purchaseToken)
        assertEquals("com.bilingify.readest.monthly.plus", replace.oldProductId)
    }

    @Test
    fun upgradingTierReplacesTheExistingSubscription() {
        val result = resolveSubscriptionReplacement(
            existing = listOf(sub("com.bilingify.readest.monthly.plus")),
            newProductId = "com.bilingify.readest.monthly.pro",
        )

        assertTrue(result is SubscriptionReplacement.Replace)
    }

    @Test
    fun repurchasingTheSameProductIsNotAReplacement() {
        val result = resolveSubscriptionReplacement(
            existing = listOf(sub("com.bilingify.readest.yearly.pro")),
            newProductId = "com.bilingify.readest.yearly.pro",
        )

        assertEquals(SubscriptionReplacement.None, result)
    }

    @Test
    fun firstSubscriptionIsNotAReplacement() {
        val result = resolveSubscriptionReplacement(
            existing = emptyList(),
            newProductId = "com.bilingify.readest.yearly.plus",
        )

        assertEquals(SubscriptionReplacement.None, result)
    }

    @Test
    fun pendingPurchasesAreNotReplaced() {
        val result = resolveSubscriptionReplacement(
            existing = listOf(sub("com.bilingify.readest.monthly.plus", isPurchased = false)),
            newProductId = "com.bilingify.readest.yearly.plus",
        )

        assertEquals(SubscriptionReplacement.None, result)
    }

    @Test
    fun aFailedQueryAbortsInsteadOfBuyingASecondSubscription() {
        // queryPurchases reports a terminal failure as a null list. Treating
        // that as "no active subscription" would launch a plain billing flow
        // and leave the user paying for two subscriptions — the exact outcome
        // the replacement flow exists to prevent.
        val result = resolveSubscriptionReplacement(
            existing = null,
            newProductId = "com.bilingify.readest.yearly.plus",
        )

        assertEquals(SubscriptionReplacement.Abort, result)
    }

    @Test
    fun theMostRecentSubscriptionIsReplacedWhenSeveralAreActive() {
        // A user who was double-subscribed by the old flow can hold more than
        // one. Replacing an arbitrary one makes the choice unpredictable, so
        // pick deterministically; the older one still has to be cancelled in
        // Play, which the client cannot do.
        val result = resolveSubscriptionReplacement(
            existing = listOf(
                sub("com.bilingify.readest.monthly.plus", purchaseTimeMillis = 1_000L),
                sub("com.bilingify.readest.monthly.pro", purchaseTimeMillis = 9_000L),
            ),
            newProductId = "com.bilingify.readest.yearly.pro",
        )

        val replace = result as SubscriptionReplacement.Replace
        assertEquals("com.bilingify.readest.monthly.pro", replace.oldProductId)
    }
}
