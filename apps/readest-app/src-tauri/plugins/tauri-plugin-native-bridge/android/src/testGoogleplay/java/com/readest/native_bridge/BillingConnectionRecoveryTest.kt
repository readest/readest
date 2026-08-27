package com.readest.native_bridge

import com.android.billingclient.api.BillingClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

class BillingConnectionRecoveryTest {
    @Test
    fun callersWhileConnectingWaitForOneInitialSetup() {
        val state = BillingSetupState()
        val results = mutableListOf<Boolean>()
        var setupStarts = 0

        state.awaitSetup({ setupStarts++ }, results::add)
        state.awaitSetup({ setupStarts++ }, results::add)

        assertEquals(1, setupStarts)
        assertTrue(results.isEmpty())

        state.complete(true)

        assertEquals(listOf(true, true), results)
    }

    @Test
    fun concurrentCallersStartOneInitialSetup() {
        val state = BillingSetupState()
        val setupStarts = AtomicInteger()
        val start = CountDownLatch(1)
        val callers = List(16) {
            thread(start = false) {
                start.await()
                state.awaitSetup({ setupStarts.incrementAndGet() }) {}
            }
        }

        callers.forEach(Thread::start)
        start.countDown()
        callers.forEach(Thread::join)

        assertEquals(1, setupStarts.get())
    }

    @Test
    fun callerRacingSetupCompletionIsCompletedOnce() {
        repeat(100) {
            val state = BillingSetupState()
            val callbackCount = AtomicInteger()
            val start = CountDownLatch(1)

            state.awaitSetup({}) {}
            val completeSetup = thread(start = false) {
                start.await()
                state.complete(true)
            }
            val addCaller = thread(start = false) {
                start.await()
                state.awaitSetup({}, { callbackCount.incrementAndGet() })
            }

            completeSetup.start()
            addCaller.start()
            start.countDown()
            completeSetup.join()
            addCaller.join()

            assertEquals(1, callbackCount.get())
        }
    }

    @Test
    fun failedInitialSetupCanBeRetried() {
        val state = BillingSetupState()
        val results = mutableListOf<Boolean>()
        var setupStarts = 0

        state.awaitSetup({ setupStarts++ }, results::add)
        state.complete(false)
        state.awaitSetup({ setupStarts++ }, results::add)
        state.complete(true)

        assertEquals(2, setupStarts)
        assertEquals(listOf(false, true), results)
    }

    @Test
    fun successfulInitialSetupDoesNotRestartForLaterCallers() {
        val state = BillingSetupState()
        val results = mutableListOf<Boolean>()
        var setupStarts = 0

        state.awaitSetup({ setupStarts++ }, results::add)
        state.complete(true)
        state.awaitSetup({ setupStarts++ }, results::add)

        assertEquals(1, setupStarts)
        assertEquals(listOf(true, true), results)
    }

    @Test
    fun serviceDisconnectedRetryIsBounded() {
        val disconnected = BillingClient.BillingResponseCode.SERVICE_DISCONNECTED

        assertTrue(shouldRetryBillingQuery(disconnected, attempt = 1))
        assertTrue(shouldRetryBillingQuery(disconnected, attempt = 2))
        assertFalse(shouldRetryBillingQuery(disconnected, attempt = 3))
        assertFalse(shouldRetryBillingQuery(BillingClient.BillingResponseCode.ERROR, attempt = 1))
    }
}
