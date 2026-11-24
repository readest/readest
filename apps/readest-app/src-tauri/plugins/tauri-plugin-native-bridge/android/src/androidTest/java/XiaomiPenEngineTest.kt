package com.readest.native_bridge

import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.ServiceConnection
import android.os.Binder
import android.os.Parcel
import android.os.RemoteException
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the shipped engine with real Android Parcels, not JVM Android stubs. */
@RunWith(AndroidJUnit4::class)
class XiaomiPenEngineTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val component = ComponentName("com.xiaomi.touchservice", "PenEngine")

    private class BindingContext(base: Context) : ContextWrapper(base) {
        var binds = 0
        var unbinds = 0
        override fun getApplicationContext(): Context = this
        override fun bindService(intent: Intent, connection: ServiceConnection, flags: Int): Boolean {
            binds++
            return true
        }
        override fun unbindService(connection: ServiceConnection) { unbinds++ }
    }

    private class EngineBinder : Binder() {
        val calls = mutableListOf<Int>()
        var unsupported = 0
        var omitStatus = false
        var failDisable = false
        var enableStatus = 0
        var transientFailures = 0
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            data.enforceInterface("com.xiaomi.touchservice.pencilengine.IPencilEngine")
            calls.add(code)
            if (code == unsupported) return false
            if (transientFailures > 0) {
                transientFailures--
                throw RemoteException("Transient registration failure")
            }
            if (code == 3) {
                assertEquals(2, data.readInt())
                val enabled = data.readInt()
                if (enabled == 0 && failDisable) throw RemoteException("Cannot disable")
                reply!!.writeNoException()
                if (!omitStatus) reply.writeInt(if (enabled == 1) enableStatus else 0)
            } else {
                if (code == 1 || code == 4) assertNotNull(data.readStrongBinder())
                if (code == 4) assertNotNull(data.readString())
                reply!!.writeNoException() // register/unregister return void
            }
            return true
        }
    }

    private fun onMain(block: () -> Unit) {
        var failure: Throwable? = null
        instrumentation.runOnMainSync {
            try {
                block()
            } catch (error: Throwable) {
                failure = error
            }
        }
        failure?.let { throw it }
    }

    @Test fun voidRegistrationAndIndependentTeardown() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        val binder = EngineBinder()
        onMain {
            pen.register()
            pen.onServiceConnected(component, binder)
            assertTrue(pen.registered)
            binder.failDisable = true
            pen.unregister()
            assertFalse(pen.registered)
            assertEquals(listOf(3, 2), binder.calls.takeLast(2))
            assertEquals(1, context.unbinds)
        }
    }

    @Test fun unsupportedTransactionCannotRegister() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        val binder = EngineBinder().apply { unsupported = 3 }
        onMain {
            pen.register()
            pen.onServiceConnected(component, binder)
            assertFalse("Unsupported SET_FEATURE must not count as success", pen.registered)
            assertEquals(2, binder.calls.last())
            assertEquals(1, context.unbinds)
            pen.unregister()
        }
    }

    @Test fun missingFeatureStatusCannotRegister() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        val binder = EngineBinder().apply { omitStatus = true }
        onMain {
            pen.register()
            pen.onServiceConnected(component, binder)
            assertFalse("Missing status must not be read as successful zero", pen.registered)
            assertEquals(2, binder.calls.last())
            pen.unregister()
        }
    }

    @Test fun failedFeatureEnableRollsBackRegistration() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        val binder = EngineBinder().apply { enableStatus = 1 }
        onMain {
            pen.register()
            pen.onServiceConnected(component, binder)
            assertFalse(pen.registered)
            assertEquals("Failed initialization must unregister", 2, binder.calls.last())
            assertEquals(1, context.unbinds)
            pen.unregister()
        }
    }

    @Test fun ordinaryDisconnectKeepsBindingAndReconnectRegistersAgain() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        onMain {
            pen.register()
            pen.onServiceConnected(component, EngineBinder())
            pen.onServiceDisconnected(component)
            assertFalse(pen.registered)
            assertEquals(0, context.unbinds)
            pen.onServiceConnected(component, EngineBinder())
            assertTrue(pen.registered)
            assertEquals(1, context.binds)
            pen.unregister()
        }
    }

    @Test fun bindingDeathRebindsOnlyWhileActive() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        onMain {
            pen.register()
            pen.onServiceConnected(component, EngineBinder())
            pen.onBindingDied(component)
            assertFalse(pen.registered)
            assertEquals(2, context.binds)
            assertEquals(1, context.unbinds)
            pen.unregister()
            pen.onBindingDied(component)
            assertEquals(2, context.binds)
        }
    }

    @Test fun nullBindingReleasesTrackingWithoutHotRetry() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        onMain {
            pen.register()
            pen.onNullBinding(component)
            assertFalse(pen.registered)
            assertEquals(1, context.unbinds)
            assertEquals(1, context.binds)
            pen.register()
            assertEquals(2, context.binds)
            pen.unregister()
        }
    }

    @Test fun transientFailureRetriesOnceWithoutServiceDisconnect() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        onMain {
            pen.register()
            pen.onServiceConnected(component, EngineBinder().apply { transientFailures = 1 })
            assertFalse(pen.registered)
        }
        // Only the Android test thread waits; production retry runs on the main Looper.
        Thread.sleep(1500)
        onMain {
            assertEquals("Transient init failure should schedule a new bind", 2, context.binds)
            pen.onServiceConnected(component, EngineBinder().apply { transientFailures = 1 })
        }
        Thread.sleep(1500)
        onMain {
            assertEquals("Retry must be bounded", 2, context.binds)
            pen.unregister()
        }
    }

    @Test fun pauseCancelsPendingRetry() {
        val context = BindingContext(instrumentation.targetContext)
        val pen = XiaomiPenEngine(context)
        onMain {
            pen.register()
            pen.onServiceConnected(component, EngineBinder().apply { transientFailures = 1 })
            pen.unregister()
        }
        Thread.sleep(1500)
        onMain { assertEquals(1, context.binds) }
    }
}
