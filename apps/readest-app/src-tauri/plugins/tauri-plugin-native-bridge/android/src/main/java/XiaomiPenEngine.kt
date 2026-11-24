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

/**
 * HyperOS's pen engine delivers the Xiaomi Focus Pen Pro gestures as
 * KEYCODE_BUTTON_7..10 only to an app registered with it (#7875). Binding
 * fails where the service doesn't exist, so [registered] stays false on
 * every other device.
 *
 * IPencilEngine transactions: 1 register(callback), 2 unregister(),
 * 3 setFeature(id, on) returning 0 on success (touch gestures are feature 2),
 * 4 register(callback, packageName) on engine version 0.3.2.
 */
class XiaomiPenEngine(context: Context) : ServiceConnection {
    private val context = context.applicationContext
    private var bound = false
    private var engine: IBinder? = null

    var registered = false
        private set

    // The engine reports colour picks to this callback; Readest ignores them.
    private val callback = object : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (code != FIRST_CALL_TRANSACTION) return super.onTransact(code, data, reply, flags)
            reply?.writeNoException()
            return true
        }
    }.apply { attachInterface(null, "$ENGINE.IPencilEngineCallback") }

    fun register() {
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

    fun unregister() {
        if (!bound) return
        engine?.let { service ->
            runCatching {
                call(service, SET_FEATURE) { writeInt(TOUCH_GESTURES); writeInt(0) }
                call(service, UNREGISTER) {}
            }
        }
        context.unbindService(this)
        bound = false
        engine = null
        registered = false
    }

    override fun onServiceConnected(name: ComponentName, service: IBinder) {
        engine = service
        registered = try {
            val version = Settings.System.getString(
                context.contentResolver,
                "stylus_pencil_engine_version",
            )
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
            Log.w(TAG, "Pen engine registration failed", e)
            false
        }
    }

    // The binding outlives an engine restart, which connects (and registers) again.
    override fun onServiceDisconnected(name: ComponentName) {
        engine = null
        registered = false
    }

    private fun call(service: IBinder, code: Int, args: Parcel.() -> Unit): Int {
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
            data.writeInterfaceToken("$ENGINE.IPencilEngine")
            data.args()
            service.transact(code, data, reply, 0)
            reply.readException()
            return reply.readInt()
        } finally {
            data.recycle()
            reply.recycle()
        }
    }

    private companion object {
        const val TAG = "XiaomiPenEngine"
        const val PACKAGE = "com.xiaomi.touchservice"
        const val ENGINE = "$PACKAGE.pencilengine"
        const val REGISTER = 1
        const val UNREGISTER = 2
        const val SET_FEATURE = 3
        const val REGISTER_PACKAGE = 4
        const val TOUCH_GESTURES = 2
    }
}
