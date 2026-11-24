package com.readest.native_bridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Parcel
import android.os.RemoteException
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
    private var active = false
    private var bound = false
    private var engine: IBinder? = null
    private val handler = Handler(Looper.getMainLooper())
    private var retryAvailable = true
    private val retry = Runnable { if (active) bind() }

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
        if (!active) retryAvailable = true
        active = true
        handler.removeCallbacks(retry)
        bind()
    }

    fun unregister() {
        active = false
        handler.removeCallbacks(retry)
        release()
    }

    private fun bind() {
        if (!active || bound) return
        val intent = Intent().setClassName(PACKAGE, "$ENGINE.PencilEngineManagerService")
        bound = try {
            context.bindService(intent, this, Context.BIND_AUTO_CREATE)
        } catch (e: SecurityException) {
            false
        }
        // A failed bindService still holds the connection until unbound.
        if (!bound) runCatching { context.unbindService(this) }
    }

    private fun release() {
        if (!bound) return
        engine?.let { service ->
            // Keep teardown calls independent: a failed feature disable must not
            // prevent sending UNREGISTER, or the pen engine keeps routing the
            // gestures to Readest while it is in the background (#7876 review).
            runCatching {
                call(service, SET_FEATURE) { writeInt(TOUCH_GESTURES); writeInt(0) }
            }
            runCatching {
                call(service, UNREGISTER) {}
            }
        }
        unbind()
    }

    private fun unbind() {
        if (bound) runCatching { context.unbindService(this) }
        bound = false
        engine = null
        registered = false
    }

    override fun onServiceConnected(name: ComponentName, service: IBinder) {
        if (!active || !bound) return
        engine = service
        try {
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
            check(call(service, SET_FEATURE) { writeInt(TOUCH_GESTURES); writeInt(1) } == 0) {
                "Pen engine refused touch gestures"
            }
            registered = true
        } catch (e: Exception) {
            Log.w(TAG, "Pen engine registration failed", e)
            // REGISTER may have succeeded before enabling gestures failed.
            release()
            if (e is RemoteException && active && retryAvailable) {
                retryAvailable = false
                handler.postDelayed(retry, 1000L)
            }
        }
    }

    // The binding outlives an engine restart, which connects (and registers) again.
    override fun onServiceDisconnected(name: ComponentName) {
        engine = null
        registered = false
    }

    // A dead binding is not reconnected by Android, so release it explicitly and
    // bind again only while Readest is still in front (#7876 review).
    override fun onBindingDied(name: ComponentName) {
        unbind()
        if (active) bind()
    }

    override fun onNullBinding(name: ComponentName) {
        // This binding will never connect; do not keep its tracking resources
        // or immediately retry a service that deliberately returned no binder.
        unbind()
    }

    private fun call(service: IBinder, code: Int, args: Parcel.() -> Unit): Int {
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
            data.writeInterfaceToken("$ENGINE.IPencilEngine")
            data.args()
            check(service.transact(code, data, reply, 0)) { "Unsupported pen engine transaction $code" }
            check(reply.dataAvail() >= 4) { "Missing pen engine exception header" }
            reply.readException()
            // Only SET_FEATURE has a return value; register/unregister are void.
            if (code != SET_FEATURE) return 0
            check(reply.dataAvail() >= 4) { "Missing pen engine feature status" }
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
