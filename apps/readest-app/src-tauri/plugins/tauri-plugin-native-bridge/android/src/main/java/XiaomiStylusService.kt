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
import android.provider.Settings
import android.util.Log

/**
 * Registers with HyperOS's pencil engine so the system delivers the Focus Pen
 * Pro gesture keycodes (squeeze / double tap / slide) to thisActivity.
 * Uses the public Binder protocol, not the vendor SDK AAR; see docs at
 * https://github.com/LanRhyme/ReveriePaint/blob/main/docs/XIAOMI-STYLUS.md
 */
class XiaomiStylusService(context: Context) {
    companion object {
        private const val TAG = "XiaomiStylusService"
        private const val PACKAGE = "com.xiaomi.touchservice"
        private const val SERVICE = "$PACKAGE.pencilengine.PencilEngineManagerService"
        private const val DESCRIPTOR = "$PACKAGE.pencilengine.IPencilEngine"
        private const val CALLBACK_DESCRIPTOR = "$PACKAGE.pencilengine.IPencilEngineCallback"
        private const val REGISTER = IBinder.FIRST_CALL_TRANSACTION
        private const val UNREGISTER = IBinder.FIRST_CALL_TRANSACTION + 1
        private const val COMMAND = IBinder.FIRST_CALL_TRANSACTION + 2
        private const val REGISTER_WITH_PACKAGE = IBinder.FIRST_CALL_TRANSACTION + 3
        private const val TOUCH_FILM = 2
    }

    private val appContext = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private var active = false
    private var connection: ServiceConnection? = null
    private var remote: IBinder? = null
    private var registered = false
    private var enabled = false
    private val reconnect = Runnable { if (active) bind() }

    private val callback = object : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (code == IBinder.INTERFACE_TRANSACTION) {
                reply?.writeString(CALLBACK_DESCRIPTOR)
                return true
            }
            if (code == IBinder.FIRST_CALL_TRANSACTION) {
                data.enforceInterface(CALLBACK_DESCRIPTOR)
                repeat(3) { data.readInt() }
                reply?.writeNoException()
                return true
            }
            return super.onTransact(code, data, reply, flags)
        }
    }

    fun start() {
        active = true
        if (connection == null) bind()
    }

    fun stop() {
        active = false
        handler.removeCallbacks(reconnect)
        unbind()
    }

    private fun bind() {
        if (!active || connection != null) return
        val newConnection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) {
                if (!active || connection !== this) return
                remote = service
                try {
                    check(service.interfaceDescriptor == DESCRIPTOR) { "Unexpected pencil interface" }
                    val version = Settings.System.getString(
                        appContext.contentResolver,
                        "stylus_pencil_engine_version",
                    )
                    val withPackage = version == "0.3.2"
                    transact(if (withPackage) REGISTER_WITH_PACKAGE else REGISTER) {
                        writeStrongBinder(callback)
                        if (withPackage) writeString(appContext.packageName)
                    }
                    registered = true
                    val result = setEnabled(true)
                    check(result == 0) { "Enable touch-film returned $result" }
                    enabled = true
                    Log.i(TAG, "Pencil gesture service ready, engineVersion=$version")
                } catch (error: Exception) {
                    Log.w(TAG, "Cannot register pencil gesture service", error)
                    unbind()
                }
            }

            override fun onServiceDisconnected(name: ComponentName) {
                if (connection !== this) return
                remote = null
                registered = false
                enabled = false
            }

            override fun onBindingDied(name: ComponentName) {
                if (connection !== this) return
                unbind()
                if (active) handler.postDelayed(reconnect, 500L)
            }

            override fun onNullBinding(name: ComponentName) {
                if (connection !== this) return
                unbind()
            }
        }
        connection = newConnection
        try {
            val intent = Intent().setComponent(ComponentName(PACKAGE, SERVICE))
            if (!appContext.bindService(intent, newConnection, Context.BIND_AUTO_CREATE)) {
                connection = null
                Log.w(TAG, "Pencil gesture service unavailable on this system")
            }
        } catch (error: Exception) {
            connection = null
            Log.w(TAG, "Cannot bind pencil gesture service", error)
        }
    }

    private fun unbind() {
        val oldConnection = connection
        connection = null
        if (enabled) {
            runCatching { setEnabled(false) }
        }
        if (registered) {
            runCatching { transact(UNREGISTER) {} }
        }
        remote = null
        registered = false
        enabled = false
        if (oldConnection != null) {
            runCatching { appContext.unbindService(oldConnection) }
        }
    }

    private fun setEnabled(value: Boolean): Int = transact(COMMAND, readResult = true) {
        writeInt(TOUCH_FILM)
        writeInt(if (value) 1 else 0)
    }

    private fun transact(
        code: Int,
        readResult: Boolean = false,
        writeArguments: Parcel.() -> Unit,
    ): Int {
        val service = checkNotNull(remote)
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        try {
            data.writeInterfaceToken(DESCRIPTOR)
            data.writeArguments()
            check(service.transact(code, data, reply, 0)) { "Unsupported pencil transaction $code" }
            reply.readException()
            return if (readResult) reply.readInt() else 0
        } finally {
            reply.recycle()
            data.recycle()
        }
    }
}
