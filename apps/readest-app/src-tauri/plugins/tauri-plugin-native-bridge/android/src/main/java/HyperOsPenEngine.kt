package com.readest.native_bridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Binder
import android.os.IBinder
import android.os.Parcel
import android.provider.Settings
import android.util.Log
import android.view.InputDevice
import android.view.KeyEvent

/**
 * HyperOS's pen engine (com.xiaomi.touchservice), used by the Focus Pen Pro.
 * Its IPencilEngine transactions: 1 register(callback), 2 unregister(),
 * 3 setFeature(id, on) returning 0 on success (touch gestures are feature 2),
 * and 4 register(callback, packageName) on engine version 0.3.2.
 */
class HyperOsPenEngine(context: Context) : PenEngine, ServiceConnection {
    private val context = context.applicationContext
    private var bound = false
    private var service: IBinder? = null
    private var registered = false

    // The engine reports colour picks to this callback; Readest ignores them.
    private val callback = object : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (code != FIRST_CALL_TRANSACTION) return super.onTransact(code, data, reply, flags)
            reply?.writeNoException()
            return true
        }
    }.apply { attachInterface(null, "$ENGINE.IPencilEngineCallback") }

    override fun register() {
        if (bound) return
        val intent = Intent().setClassName(PACKAGE, "$ENGINE.PencilEngineManagerService")
        bound = try {
            context.bindService(intent, this, Context.BIND_AUTO_CREATE)
        } catch (e: SecurityException) {
            false
        }
        // A failed bindService still holds the connection until unbound.
        if (!bound) runCatching { context.unbindService(this) }
    }

    override fun unregister() {
        if (!bound) return
        service?.let {
            // Separate calls: a failed disable must not keep UNREGISTER from being sent.
            runCatching { call(it, SET_FEATURE) { writeInt(TOUCH_GESTURES); writeInt(0) } }
            runCatching { call(it, UNREGISTER) {} }
        }
        context.unbindService(this)
        bound = false
        service = null
        registered = false
    }

    override fun gestureKeyName(keyCode: Int, source: Int): String? =
        if (registered) keyName(keyCode, source) else null

    override fun onServiceConnected(name: ComponentName, service: IBinder) {
        this.service = service
        registered = try {
            val version = Settings.System.getString(context.contentResolver, VERSION_SETTING)
            if (version == "0.3.2") {
                call(service, REGISTER_PACKAGE) {
                    writeStrongBinder(callback)
                    writeString(context.packageName)
                }
            } else {
                call(service, REGISTER) { writeStrongBinder(callback) }
            }
            call(service, SET_FEATURE) { writeInt(TOUCH_GESTURES); writeInt(1) } == 0
        } catch (e: Exception) {
            // No retry on a live binding: the next onPause/onResume binds afresh.
            Log.w(TAG, "Pen engine registration failed", e)
            false
        }
    }

    // The binding survives an engine restart, which connects and registers again.
    override fun onServiceDisconnected(name: ComponentName) {
        service = null
        registered = false
    }

    // The engine's package was updated or removed: only a new binding reaches it.
    override fun onBindingDied(name: ComponentName) {
        unregister()
        register()
    }

    /** Sends one IPencilEngine call and returns its status (only SET_FEATURE has one). */
    private fun call(service: IBinder, code: Int, args: Parcel.() -> Unit): Int {
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
            data.writeInterfaceToken("$ENGINE.IPencilEngine")
            data.args()
            check(service.transact(code, data, reply, 0)) { "Pen engine has no call $code" }
            reply.readException()
            return if (code == SET_FEATURE) reply.readInt() else 0
        } finally {
            data.recycle()
            reply.recycle()
        }
    }

    companion object {
        private const val TAG = "HyperOsPenEngine"
        private const val PACKAGE = "com.xiaomi.touchservice"
        private const val ENGINE = "$PACKAGE.pencilengine"
        private const val VERSION_SETTING = "stylus_pencil_engine_version"
        private const val REGISTER = 1
        private const val UNREGISTER = 2
        private const val SET_FEATURE = 3
        private const val REGISTER_PACKAGE = 4
        private const val TOUCH_GESTURES = 2

        // The gestures arrive as gamepad buttons. Double tap (BUTTON_8) is left
        // out: the pen recognizes it unreliably.
        private val GESTURES = mapOf(
            KeyEvent.KEYCODE_BUTTON_7 to PenEngine.SQUEEZE,
            KeyEvent.KEYCODE_BUTTON_9 to PenEngine.SLIDE_UP,
            KeyEvent.KEYCODE_BUTTON_10 to PenEngine.SLIDE_DOWN,
        )

        /** The gesture for a key event, unless a real gamepad or joystick sent it. */
        internal fun keyName(keyCode: Int, source: Int): String? {
            val fromController = source and InputDevice.SOURCE_GAMEPAD == InputDevice.SOURCE_GAMEPAD ||
                source and InputDevice.SOURCE_JOYSTICK == InputDevice.SOURCE_JOYSTICK
            return if (fromController) null else GESTURES[keyCode]
        }
    }
}
