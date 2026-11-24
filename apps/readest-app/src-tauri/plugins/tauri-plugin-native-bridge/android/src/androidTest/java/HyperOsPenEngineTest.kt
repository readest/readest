package com.readest.native_bridge

import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.ServiceConnection
import android.os.Binder
import android.os.Parcel
import android.os.RemoteException
import android.view.InputDevice
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

/** HyperOsPenEngine against a fake engine, with real Parcels. */
@RunWith(AndroidJUnit4::class)
class HyperOsPenEngineTest {
    private val component = ComponentName("com.xiaomi.touchservice", "PencilEngineManagerService")
    private val context = FakeContext(InstrumentationRegistry.getInstrumentation().targetContext)
    private val engine = FakeEngine()
    private val pen = HyperOsPenEngine(context)

    private class FakeContext(base: Context) : ContextWrapper(base) {
        var binds = 0
        var unbinds = 0
        override fun getApplicationContext(): Context = this
        override fun bindService(intent: Intent, connection: ServiceConnection, flags: Int): Boolean {
            binds++
            return true
        }
        override fun unbindService(connection: ServiceConnection) {
            unbinds++
        }
    }

    private class FakeEngine : Binder() {
        val calls = mutableListOf<String>()
        var featureStatus = 0
        var failDisable = false

        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            data.enforceInterface("com.xiaomi.touchservice.pencilengine.IPencilEngine")
            when (code) {
                // Which register call arrives depends on the device's engine version.
                1 -> calls.add("register:" + (data.readStrongBinder() != null))
                4 -> calls.add(
                    "register:" + (data.readStrongBinder() != null && data.readString() != null),
                )
                2 -> calls.add("unregister")
                3 -> {
                    val feature = data.readInt()
                    val on = data.readInt()
                    calls.add("setFeature:$feature:$on")
                    if (on == 0 && failDisable) throw RemoteException("cannot disable")
                    reply!!.writeNoException()
                    reply.writeInt(if (on == 1) featureStatus else 0)
                    return true
                }
                else -> return false
            }
            reply!!.writeNoException()
            return true
        }
    }

    private fun gesture(keyCode: Int) = pen.gestureKeyName(keyCode, InputDevice.SOURCE_KEYBOARD)

    @Test
    fun registersWithTheCallbackAndEnablesTouchGestures() {
        pen.register()
        assertNull(gesture(KeyEvent.KEYCODE_BUTTON_10))
        pen.onServiceConnected(component, engine)
        assertEquals(listOf("register:true", "setFeature:2:1"), engine.calls)
        assertEquals(PenEngine.SLIDE_DOWN, gesture(KeyEvent.KEYCODE_BUTTON_10))
        pen.unregister()
    }

    @Test
    fun refusedTouchGesturesLeaveItUnregistered() {
        engine.featureStatus = 1
        pen.register()
        pen.onServiceConnected(component, engine)
        assertNull(gesture(KeyEvent.KEYCODE_BUTTON_10))
        pen.unregister()
    }

    @Test
    fun unregisterSendsUnregisterEvenWhenDisablingFails() {
        engine.failDisable = true
        pen.register()
        pen.onServiceConnected(component, engine)
        pen.unregister()
        assertEquals(listOf("setFeature:2:0", "unregister"), engine.calls.takeLast(2))
        assertEquals(1, context.unbinds)
        assertNull(gesture(KeyEvent.KEYCODE_BUTTON_10))
    }

    @Test
    fun anEngineRestartRegistersAgainOnTheSameBinding() {
        pen.register()
        pen.onServiceConnected(component, engine)
        pen.onServiceDisconnected(component)
        assertNull(gesture(KeyEvent.KEYCODE_BUTTON_10))
        pen.onServiceConnected(component, FakeEngine())
        assertEquals(PenEngine.SLIDE_DOWN, gesture(KeyEvent.KEYCODE_BUTTON_10))
        assertEquals(1, context.binds)
        assertEquals(0, context.unbinds)
        pen.unregister()
    }

    @Test
    fun aDeadBindingIsReplaced() {
        pen.register()
        pen.onServiceConnected(component, engine)
        pen.onServiceDisconnected(component)
        pen.onBindingDied(component)
        assertEquals(1, context.unbinds)
        assertEquals(2, context.binds)
        pen.unregister()
    }
}
