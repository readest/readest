package com.readest.native_bridge

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.provider.DocumentsContract
import android.view.View
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowManager
import android.view.WindowInsetsController
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.PixelCopy
import android.webkit.WebView
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.fonts.SystemFonts
import android.graphics.fonts.Font
import androidx.core.view.WindowCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.JSArray
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import org.json.JSONArray
import java.io.*
import kotlinx.coroutines.*

@InvokeArg
class AuthRequestArgs {
    var authUrl: String? = null
}

@InvokeArg
class CopyURIRequestArgs {
    var uri: String? = null
    var dst: String? = null
}

@InvokeArg
class SaveImageToGalleryRequestArgs {
    var srcPath: String? = null
    var fileName: String? = null
    var mimeType: String? = null
    var albumName: String? = null
}

@InvokeArg
class InstallPackageRequestArgs {
    var path: String? = null
}

@InvokeArg
class SetSystemUIVisibilityRequestArgs {
    var visible: Boolean? = false
    var darkMode: Boolean? = false
}

@InvokeArg
class InterceptKeysRequestArgs {
    var volumeKeys: Boolean? = null
    var backKey: Boolean? = null
    var pageTurnerKeys: Boolean? = null
    var learnMode: Boolean? = null
}

@InvokeArg
class LockScreenOrientationRequestArgs {
    var orientation: String? = null
}

@InvokeArg
class SetScreenBrightnessRequestArgs {
    var brightness: Double? = null // 0.0 to 1.0
}

@InvokeArg
class OpenExternalUrlArgs {
    var url: String? = null
}

@InvokeArg
class ShowLookupPopoverArgs {
    var word: String? = null
}

@InvokeArg
class FetchProductsRequestArgs {
    val productIds: List<String>? = null
}

@InvokeArg
class PurchaseProductRequestArgs {
    val productId: String? = null
}

@InvokeArg
class UpdateReadingWidgetBookArgs {
    var hash: String = ""
    var title: String = ""
    var author: String = ""
    var percent: Int = 0
    var coverPath: String = ""
}

@InvokeArg
class CaptureWebviewRegionArgs {
    var x: Float = 0f
    var y: Float = 0f
    var width: Float = 0f
    var height: Float = 0f
}

@InvokeArg
class UpdateReadingWidgetTtsArgs {
    var active: Boolean = false
    var playing: Boolean = false
}

@InvokeArg
class UpdateReadingWidgetRequestArgs {
    var books: List<UpdateReadingWidgetBookArgs> = emptyList()
    var sectionTitle: String = ""
    var emptyTitle: String = ""
    // Nullable — omitted from the snapshot when the caller does not send a tts object.
    // Note: Tauri parseArgs uses Gson for deserialization; a nullable nested @InvokeArg
    // field is set to null when the key is absent from the JSON payload, which is the
    // expected behavior. If deserialization issues arise at runtime, fall back to two
    // flat optional fields (ttsActive: Boolean? / ttsPlaying: Boolean?).
    var tts: UpdateReadingWidgetTtsArgs? = null
}

data class ProductData(
    val id: String,
    val title: String,
    val description: String,
    val price: String,
    val priceCurrencyCode: String?,
    val priceAmountMicros: Long,
    val productType: String
)

data class PurchaseData(
    val productId: String,
    val orderId: String,
    val purchaseToken: String,
    val purchaseDate: String,
    val purchaseState: String,
    val platform: String = "android"
)

interface KeyDownInterceptor {
    fun interceptVolumeKeys(enabled: Boolean)
    fun interceptBackKey(enabled: Boolean)
    fun interceptPageTurnerKeys(enabled: Boolean)
    fun setKeyLearnMode(enabled: Boolean)
}

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.MANAGE_EXTERNAL_STORAGE], alias = "manageStorage"),
  ]
)
class NativeBridgePlugin(private val activity: Activity): Plugin(activity) {
    private val implementation = NativeBridge()
    private var redirectScheme = "readest"
    private var redirectHost = "auth-callback"
    private var webViewRef: WebView? = null
    private val billingManager by lazy {
        BillingManager(activity)
    }
    // Scope for offloading blocking @Command I/O (file copy, package
    // install, font scan, dictionary lookup) off the plugin command thread.
    // Cancelled in onDestroy so in-flight work can't resolve into — or leak —
    // a dead Activity.
    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onDestroy() {
        pluginScope.cancel()
        instance = null
    }

    companion object {
        private const val REQUEST_MANAGE_STORAGE = 1001
        private const val FOLDER_PICKER_REQUEST_CODE = 1002
        var pendingInvoke: Invoke? = null
        var pendingFolderPickerInvoke: Invoke? = null
        private var instance: NativeBridgePlugin? = null
        fun getInstance(): NativeBridgePlugin? = instance
    }

    override fun load(webView: WebView) {
        instance = this
        webViewRef = webView
        super.load(webView)
        handleIntent(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        Log.d("NativeBridgePlugin", "Received intent: action=${intent.action} data=${intent.data}")

        // OAuth callback uses a custom scheme on intent.data and is handled
        // separately from any user-shared content.
        intent.data?.let { uri ->
            val scheme = uri.scheme ?: ""
            val isReadestAuth = scheme == "readest" && uri.host == "auth-callback"
            // Google Drive sign-in uses the reverse-DNS "iOS URL scheme"
            // (com.googleusercontent.apps.<id>:/oauthredirect) registered as a
            // BROWSABLE deep link; resolve it through the same pending invoke as
            // the Supabase readest://auth-callback flow.
            val isGoogleOAuth = scheme.startsWith("com.googleusercontent.apps.")
            if (isReadestAuth || isGoogleOAuth) {
                val result = JSObject().apply {
                    put("redirectUrl", uri.toString())
                }
                pendingInvoke?.resolve(result)
                pendingInvoke = null
                return
            }
        }

        when (intent.action) {
            Intent.ACTION_VIEW -> {
                // "Open with Readest": the OS hands us a single content://
                // (or file://) URI on `intent.data`. Take the persistable
                // permission so we can read it through any subsequent app
                // launch, then forward it to the JS side via the existing
                // shared-intent channel — without this trigger, the URI
                // silently dies in Kotlin and the user just sees the
                // library splash with nothing happening.
                val uri = intent.data ?: return
                tryTakePersistableReadPermission(uri)
                emitSharedIntent("VIEW", listOf(uri))
            }

            Intent.ACTION_SEND -> {
                // System share-sheet → "Send to Readest" (single file).
                // The URI lives on EXTRA_STREAM, not on intent.data, which
                // is why the previous data-only handler never saw share
                // captures at all.
                val uri = getExtraStream(intent) ?: return
                tryTakePersistableReadPermission(uri)
                emitSharedIntent("SEND", listOf(uri))
            }

            Intent.ACTION_SEND_MULTIPLE -> {
                val uris = getExtraStreamList(intent)
                if (uris.isEmpty()) return
                uris.forEach { tryTakePersistableReadPermission(it) }
                emitSharedIntent("SEND", uris)
            }
        }
    }

    private fun tryTakePersistableReadPermission(uri: Uri) {
        // Only content:// URIs support persistable permissions; file://
        // URIs are accessible directly and would throw SecurityException
        // here. Skip the call rather than swallow noisy logs.
        if (uri.scheme != "content") return
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (e: SecurityException) {
            Log.w("NativeBridgePlugin", "takePersistableUriPermission failed for $uri: ${e.message}")
        }
    }

    @Suppress("DEPRECATION")
    private fun getExtraStream(intent: Intent): Uri? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
        }
    }

    @Suppress("DEPRECATION")
    private fun getExtraStreamList(intent: Intent): List<Uri> {
        val list: ArrayList<Uri>? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
            }
        return list ?: emptyList()
    }

    // shared-intent events emitted before the JS side has registered its
    // listener via addPluginListener("native-bridge", "shared-intent", ...)
    // would otherwise vanish — the upstream Plugin.trigger() drops events
    // when the per-event listener list is empty. This is exactly what
    // happens on cold launch via "Open with Readest": Android delivers the
    // ACTION_VIEW intent to onCreate / onNewIntent (the WebView is already
    // up but the JS app is mid-hydration), we emit it through triggerEvent
    // immediately, and useAppUrlIngress's addPluginListener call lands a
    // few hundred ms later — too late to receive the now-discarded event.
    //
    // To fix this we queue events whenever no listener is registered, then
    // replay the queue when a registerListener call lands for this event
    // (see overridden registerListener below).
    private val pendingEvents: MutableMap<String, MutableList<JSObject>> = mutableMapOf()
    private val pendingEventsLock = Any()

    private fun emitSharedIntent(action: String, uris: List<Uri>) {
        val payload = JSObject().apply {
            put("action", action)
            val arr = JSArray()
            uris.forEach { arr.put(it.toString()) }
            put("urls", arr)
        }
        emitOrQueue("shared-intent", payload)
    }

    private fun emitOrQueue(eventName: String, payload: JSObject) {
        if (hasListener(eventName)) {
            triggerEvent(eventName, payload)
        } else {
            synchronized(pendingEventsLock) {
                val list = pendingEvents.getOrPut(eventName) { mutableListOf() }
                list.add(payload)
            }
            Log.d("NativeBridgePlugin", "Queued $eventName payload (no listener yet); pending size=${pendingEvents[eventName]?.size}")
        }
    }

    override fun registerListener(invoke: Invoke) {
        super.registerListener(invoke)
        // After super.registerListener, the listener is now wired up.
        // Drain any queued events for the same name so the JS side gets
        // events that were emitted between native start and listener
        // registration.
        // The event name lives on the invoke args, not directly accessible
        // post-resolve; instead, drain every queued bucket whose key has a
        // listener now. Cheap because there's at most one or two events.
        val toReplay = mutableListOf<Pair<String, JSObject>>()
        synchronized(pendingEventsLock) {
            val toRemove = mutableListOf<String>()
            for ((event, list) in pendingEvents) {
                if (hasListener(event)) {
                    list.forEach { toReplay.add(event to it) }
                    toRemove.add(event)
                }
            }
            toRemove.forEach { pendingEvents.remove(it) }
        }
        if (toReplay.isNotEmpty()) {
            Log.d("NativeBridgePlugin", "Replaying ${toReplay.size} queued event(s) after registerListener")
            for ((event, payload) in toReplay) {
                triggerEvent(event, payload)
            }
        }
    }

    @Command
    fun auth_with_custom_tab(invoke: Invoke) {
        val args = invoke.parseArgs(AuthRequestArgs::class.java)
        val uri = Uri.parse(args.authUrl)

        val customTabsIntent = CustomTabsIntent.Builder().build()
        customTabsIntent.intent.flags = Intent.FLAG_ACTIVITY_NO_HISTORY

        Log.d("NativeBridgePlugin", "Launching OAuth URL: ${args.authUrl}")
        customTabsIntent.launchUrl(activity, uri)

        pendingInvoke = invoke
    }

    @Command
    fun copy_uri_to_path(invoke: Invoke) {
        val args = invoke.parseArgs(CopyURIRequestArgs::class.java)
        pluginScope.launch {
            val ret = withContext(Dispatchers.IO) {
                val r = JSObject()
                try {
                    val uri = Uri.parse(args.uri ?: "")
                    val dst = File(args.dst ?: "")
                    val inputStream = activity.contentResolver.openInputStream(uri)

                    if (inputStream != null) {
                        dst.outputStream().use { output ->
                            inputStream.use { input ->
                                input.copyTo(output)
                            }
                        }
                        r.put("success", true)
                    } else {
                        r.put("success", false)
                        r.put("error", "Failed to open input stream from URI")
                    }
                } catch (e: Exception) {
                    r.put("success", false)
                    r.put("error", e.message)
                }
                r
            }
            if (isActive) invoke.resolve(ret)
        }
    }

    @Command
    fun save_image_to_gallery(invoke: Invoke) {
        val args = invoke.parseArgs(SaveImageToGalleryRequestArgs::class.java)
        pluginScope.launch {
            val ret = withContext(Dispatchers.IO) {
                val r = JSObject()
                try {
                    val srcFile = File(args.srcPath ?: "")
                    if (!srcFile.exists()) {
                        r.put("success", false)
                        r.put("error", "Source file does not exist")
                        return@withContext r
                    }
                    val displayName = args.fileName ?: srcFile.name
                    val mimeType = args.mimeType ?: "image/*"
                    val album = args.albumName ?: "Readest"
                    val resolver = activity.contentResolver

                    val values = ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
                        put(MediaStore.Images.Media.MIME_TYPE, mimeType)
                        // Scoped storage (Android 10+): place the image under the
                        // shared Pictures collection without any storage permission,
                        // and mark it pending until the bytes are fully written.
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            put(
                                MediaStore.Images.Media.RELATIVE_PATH,
                                "${Environment.DIRECTORY_PICTURES}/$album"
                            )
                            put(MediaStore.Images.Media.IS_PENDING, 1)
                        }
                    }
                    val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    } else {
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                    }

                    val itemUri = resolver.insert(collection, values)
                    if (itemUri == null) {
                        val error = "MediaStore rejected $displayName ($mimeType) in $album"
                        Log.e("NativeBridge", error)
                        r.put("success", false)
                        r.put("error", error)
                        return@withContext r
                    }

                    resolver.openOutputStream(itemUri).use { output ->
                        if (output == null) {
                            throw IOException("Failed to open output stream")
                        }
                        srcFile.inputStream().use { input -> input.copyTo(output) }
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        val pending = ContentValues().apply {
                            put(MediaStore.Images.Media.IS_PENDING, 0)
                        }
                        resolver.update(itemUri, pending, null, null)
                    }

                    r.put("success", true)
                    r.put("uri", itemUri.toString())
                } catch (e: Exception) {
                    // OEM MediaStore implementations diverge on what they accept, so
                    // the exception is the only thing that identifies a device-specific
                    // failure from a bug report.
                    Log.e("NativeBridge", "Failed to save image to gallery", e)
                    r.put("success", false)
                    r.put("error", "${e.javaClass.simpleName}: ${e.message}")
                }
                r
            }
            if (isActive) invoke.resolve(ret)
        }
    }

    @Command
    fun install_package(invoke: Invoke) {
        val args = invoke.parseArgs(InstallPackageRequestArgs::class.java)
        pluginScope.launch {
            val ret = withContext(Dispatchers.IO) {
                val r = JSObject()
                try {
                    val file = File(args.path ?: "")
                    if (file.exists()) {
                        val intent = Intent(Intent.ACTION_VIEW)
                        val apkUri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
                        intent.setDataAndType(apkUri, "application/vnd.android.package-archive")
                        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                        val packageManager = activity.packageManager
                        val resolveInfos = packageManager.queryIntentActivities(intent, 0)
                        for (resolveInfo in resolveInfos) {
                            val packageName = resolveInfo.activityInfo.packageName
                            activity.grantUriPermission(packageName, apkUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        withContext(Dispatchers.Main) { activity.startActivity(intent) }
                        r.put("success", true)
                    } else {
                        r.put("success", false)
                        r.put("error", "File does not exist")
                    }
                } catch (e: Exception) {
                    r.put("success", false)
                    r.put("error", e.message)
                }
                r
            }
            if (isActive) invoke.resolve(ret)
        }
    }

    @Command
    fun set_system_ui_visibility(invoke: Invoke) {
        val args = invoke.parseArgs(SetSystemUIVisibilityRequestArgs::class.java)
        val visible = args.visible ?: false
        var isDarkMode = args.darkMode ?: false
        val ret = JSObject()
        try {
            val window = activity.window
            val decorView = window.decorView
            if (!visible) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    window.attributes.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                @Suppress("DEPRECATION")
                window.setDecorFitsSystemWindows(false)
                val controller = window.insetsController
                if (controller != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    } else {
                        val compatController = WindowCompat.getInsetsController(window, decorView)
                        compatController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    }

                    if (isDarkMode) {
                        controller.setSystemBarsAppearance(
                            0,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        )
                    } else {
                        controller.setSystemBarsAppearance(
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        )
                    }
                    if (visible) {
                        controller.show(WindowInsets.Type.statusBars())
                        controller.hide(WindowInsets.Type.navigationBars())
                    } else {
                        controller.hide(WindowInsets.Type.systemBars())
                    }
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val compatController = WindowCompat.getInsetsController(window, decorView)
                compatController.let {
                    it.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    if (!isDarkMode) {
                        it.isAppearanceLightStatusBars = true
                    } else {
                        it.isAppearanceLightStatusBars = false
                    }
                    if (visible) {
                        it.show(WindowInsetsCompat.Type.statusBars())
                        it.hide(WindowInsetsCompat.Type.navigationBars())
                    } else {
                        it.hide(WindowInsetsCompat.Type.systemBars())
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                decorView.systemUiVisibility = buildList {
                    add(View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
                    add(View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
                    add(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
                    add(View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
                    add(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)

                    if (!visible) {
                        add(View.SYSTEM_UI_FLAG_FULLSCREEN)
                    }
                    if (visible && !isDarkMode) {
                        add(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR)
                    }
                }.reduce { acc, flag -> acc or flag }
            }
            @Suppress("DEPRECATION")
            window.statusBarColor = Color.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor = Color.TRANSPARENT
            ret.put("success", true)
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_status_bar_height(invoke: Invoke) {
        val ret = JSObject()
        try {
            val resourceId = activity.resources.getIdentifier("status_bar_height", "dimen", "android")
            val height = if (resourceId > 0) {
                activity.resources.getDimensionPixelSize(resourceId)
            } else {
                0
            }
            ret.put("height", height)
        } catch (e: Exception) {
            ret.put("height", -1)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_sys_fonts_list(invoke: Invoke) {
        pluginScope.launch {
            val ret = withContext(Dispatchers.IO) {
                val r = JSObject()
                try {
                    val fontList = cachedFontList ?: run {
                        val fonts = scanFonts()
                        cachedFontList = fonts
                        fonts
                    }
                    val fontDict = JSObject()
                    for (fontName in fontList) {
                        fontDict.put(fontName, fontName)
                    }
                    r.put("fonts", fontDict)
                } catch (e: Exception) {
                    r.put("error", e.message)
                }
                r
            }
            if (isActive) invoke.resolve(ret)
        }
    }

    // Scanning system fonts walks the font directory and is stable for the
    // process lifetime, so cache it. @Volatile for safe publication across
    // the IO dispatcher threads.
    @Volatile
    private var cachedFontList: List<String>? = null

    private fun scanFonts(): List<String> {
        val fontList = mutableListOf<String>()
        val fontFileList = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val systemFonts = SystemFonts.getAvailableFonts()
            for (font in systemFonts) {
                val file = font.getFile() ?: continue
                if (file.isFile && (file.name.endsWith(".ttf", true) || file.name.endsWith(".otf", true))) {
                    fontFileList.add(file.name)
                }
            }
        } else {
            val fontDirs = listOf("/system/fonts", "/system/font", "/data/fonts")
            for (dirPath in fontDirs) {
                val dir = File(dirPath)
                if (dir.exists() && dir.isDirectory) {
                    dir.listFiles()?.forEach { file ->
                        if (file.isFile && (file.name.endsWith(".ttf", true) || file.name.endsWith(".otf", true))) {
                            fontFileList.add(file.name)
                        }
                    }
                }
            }
        }
        for (fileFileName in fontFileList) {
            val fontName = fileFileName
                .replace(Regex("\\.(ttf|otf)$", RegexOption.IGNORE_CASE), "")
                .trim()
            fontList.add(fontName)
        }
        return fontList
    }

    @Command
    fun intercept_keys(invoke: Invoke) {
        val args = invoke.parseArgs(InterceptKeysRequestArgs::class.java)
        if (activity is KeyDownInterceptor) {
            val interceptor = activity as KeyDownInterceptor
            args.backKey?.let { interceptor.interceptBackKey(it) }
            args.volumeKeys?.let { interceptor.interceptVolumeKeys(it) }
            args.pageTurnerKeys?.let { interceptor.interceptPageTurnerKeys(it) }
            args.learnMode?.let { interceptor.setKeyLearnMode(it) }
        } else {
            Log.e("NativeBridgePlugin", "Activity does not implement KeyDownInterceptor")
        }
        invoke.resolve()
    }

    @Command
    fun lock_screen_orientation(invoke: Invoke) {
      val args = invoke.parseArgs(LockScreenOrientationRequestArgs::class.java)
      val orientation = args.orientation ?: "auto"
      when (orientation) {
          "portrait" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
          "landscape" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
          "auto" -> activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_USER
          else -> {
              invoke.reject("Invalid orientation mode")
              return
          }
      }
      invoke.resolve()
    }

    @Command
    fun get_safe_area_insets(invoke: Invoke) {
        val ret = JSObject()
        try {
            val rootView = activity.findViewById<View>(android.R.id.content)
            val windowInsets = androidx.core.view.ViewCompat.getRootWindowInsets(rootView)

            if (windowInsets != null) {
                val insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.displayCutout()
                )
                val density = activity.resources.displayMetrics.density
                ret.put("top", insets.top / density)
                ret.put("right", insets.right / density)
                ret.put("bottom", insets.bottom / density)
                ret.put("left", insets.left / density)
            } else {
                ret.put("top", 0)
                ret.put("right", 0)
                ret.put("bottom", 0)
                ret.put("left", 0)
            }
        } catch (e: Exception) {
            ret.put("error", e.message)
            ret.put("top", 0)
            ret.put("right", 0)
            ret.put("bottom", 0)
            ret.put("left", 0)
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_screen_brightness(invoke: Invoke) {
        val ret = JSObject()
        try {
            val window = activity.window
            val layoutParams = window.attributes
            val brightness = layoutParams.screenBrightness

            if (brightness >= 0.0f) {
                ret.put("brightness", brightness.toDouble())
            } else {
                val systemBrightness = Settings.System.getInt(
                    activity.contentResolver,
                    Settings.System.SCREEN_BRIGHTNESS
                )
                ret.put("brightness", systemBrightness / 255.0)
            }
        } catch (e: Exception) {
            ret.put("error", e.message)
            ret.put("brightness", -1.0)
        }
        invoke.resolve(ret)
    }

    @Command
    fun set_screen_brightness(invoke: Invoke) {
        val args = invoke.parseArgs(SetScreenBrightnessRequestArgs::class.java)
        val ret = JSObject()
        try {
            val brightness = args.brightness?.toFloat()
            val layoutParams = activity.window.attributes

            if (brightness == null || brightness < 0.0) {
                layoutParams.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
            } else {
                if (brightness > 1.0) {
                    invoke.reject("Brightness must be between 0.0 and 1.0, or null to use system brightness")
                    return
                }
                layoutParams.screenBrightness = brightness
            }

            activity.window.attributes = layoutParams
            ret.put("success", true)
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun iap_is_available(invoke: Invoke) {
        val isAvailable = billingManager.isBillingAvailable()
        val result = JSObject()
        result.put("available", isAvailable)
        invoke.resolve(result)
    }

    @Command
    fun iap_initialize(invoke: Invoke) {
        billingManager.initialize { success ->
            val result = JSObject()
            result.put("success", success)
            invoke.resolve(result)
        }
    }

    @Command
    fun iap_fetch_products(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(FetchProductsRequestArgs::class.java)
            val productIds = args.productIds ?: emptyList()
            if (productIds.isEmpty()) {
                invoke.reject("Product IDs list is empty")
                return
            }

            billingManager.fetchProducts(productIds) { products ->
                val result = JSObject()
                val productsArray = JSArray()
                for (product in products) {
                    val productObject = JSObject().apply {
                        put("id", product.id)
                        put("title", product.title)
                        put("description", product.description)
                        put("price", product.price)
                        put("priceCurrencyCode", product.priceCurrencyCode)
                        put("priceAmountMicros", product.priceAmountMicros)
                        put("productType", product.productType)
                    }
                    productsArray.put(productObject)
                }
                result.put("products", productsArray)
                invoke.resolve(result)
            }
        } catch (e: Exception) {
            invoke.reject("Failed to parse fetch products arguments: ${e.message}")
        }
    }

    @Command
    fun iap_purchase_product(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PurchaseProductRequestArgs::class.java)
            val productId = args.productId ?: ""
            if (productId.isEmpty()) {
                invoke.reject("Product ID is empty")
                return
            }

            billingManager.purchaseProduct(productId) { purchase ->
                if (purchase != null) {
                    val result = JSObject()
                    val purchaseData = JSObject().apply {
                        put("platform", purchase.platform)
                        put("packageName", activity.packageName)
                        put("productId", purchase.productId)
                        put("orderId", purchase.orderId)
                        put("purchaseToken", purchase.purchaseToken)
                        put("purchaseDate", purchase.purchaseDate)
                        put("purchaseState", purchase.purchaseState)
                    }
                    result.put("purchase", purchaseData)
                    invoke.resolve(result)
                } else {
                    invoke.reject("Purchase failed or was cancelled")
                }
            }
        } catch (e: Exception) {
            invoke.reject("Failed to parse purchase arguments: ${e.message}")
        }
    }

    @Command
    fun iap_restore_purchases(invoke: Invoke) {
        billingManager.restorePurchases { purchases ->
            val result = JSObject()
            val purchasesArray = JSArray()
            for (purchase in purchases) {
                val purchaseObject = JSObject().apply {
                    put("platform", purchase.platform)
                    put("packageName", activity.packageName)
                    put("productId", purchase.productId)
                    put("orderId", purchase.orderId)
                    put("purchaseToken", purchase.purchaseToken)
                    put("purchaseDate", purchase.purchaseDate)
                    put("purchaseState", purchase.purchaseState)
                }
                purchasesArray.put(purchaseObject)
            }
            result.put("purchases", purchasesArray)
            invoke.resolve(result)
        }
    }

    @Command
    fun get_external_sdcard_path(invoke: Invoke) {
        val result = JSObject()
        val externalDirs = activity.getExternalFilesDirs(null)
        for (file in externalDirs) {
            if (file != null && Environment.isExternalStorageRemovable(file)) {
                val pathParts = file.absolutePath.split("/Android/")
                if (pathParts.isNotEmpty()) {
                    result.put("path", pathParts[0])
                    invoke.resolve(result)
                }
            }
        }
        result.put("path", null)
        invoke.resolve(result)
    }

    @Command
    fun request_manage_storage_permission(invoke: Invoke) {
        val ret = JSObject()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!Environment.isExternalStorageManager()) {
                try {
                    val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                    intent.data = Uri.parse("package:${activity.packageName}")
                    activity.startActivityForResult(intent, REQUEST_MANAGE_STORAGE)
                    ret.put("manageStorage", "denied")
                    invoke.resolve(ret)
                } catch (e: Exception) {
                    val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    activity.startActivity(intent)
                    ret.put("manageStorage", "denied")
                    invoke.resolve(ret)
                }
            } else {
                ret.put("manageStorage", "granted")
                invoke.resolve(ret)
            }
        } else {
            val readPermission = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.READ_EXTERNAL_STORAGE
            )
            val writePermission = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            )
            if (readPermission == PackageManager.PERMISSION_GRANTED &&
                writePermission == PackageManager.PERMISSION_GRANTED) {
                ret.put("manageStorage", "granted")
                invoke.resolve(ret)
            } else {
                ActivityCompat.requestPermissions(
                    activity,
                    arrayOf(
                        Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.WRITE_EXTERNAL_STORAGE
                    ),
                    REQUEST_MANAGE_STORAGE
                )
                ret.put("manageStorage", "prompt")
                invoke.resolve(ret)
            }
        }
    }

    @Command
    fun open_external_url(invoke: Invoke) {
        val args = invoke.parseArgs(OpenExternalUrlArgs::class.java)
        val url = args.url ?: ""

        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            val ret = JSObject()
            ret.put("success", true)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject("Failed to open URL: ${e.message}")
        }
    }

    @Command
    fun select_directory(invoke: Invoke) {
        pendingFolderPickerInvoke = invoke

        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            activity.startActivityForResult(intent, FOLDER_PICKER_REQUEST_CODE)
        } catch (e: Exception) {
            val result = JSObject()
            result.put("cancelled", true)
            result.put("uri", null)
            result.put("path", null)
            result.put("error", e.message)
            invoke.resolve(result)
            pendingFolderPickerInvoke = null
        }
    }

    fun handleActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FOLDER_PICKER_REQUEST_CODE) {
            val invoke = pendingFolderPickerInvoke
            if (invoke != null) {
                handleDirectorySelected(data?.data, invoke)
                pendingFolderPickerInvoke = null
            }
        }
    }

    private fun handleDirectorySelected(uri: Uri?, invoke: Invoke) {
        val result = JSObject()
        if (uri == null) {
            result.put("cancelled", true)
            result.put("uri", null)
            result.put("path", null)
        } else {
            try {
                val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or
                          Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                activity.contentResolver.takePersistableUriPermission(uri, flags)
                result.put("cancelled", false)
                result.put("uri", uri.toString())
                result.put("path", extractPathFromUri(uri))
            } catch (e: SecurityException) {
                result.put("cancelled", true)
                result.put("uri", uri.toString())
                result.put("path", extractPathFromUri(uri))
                result.put("error", "Permission error: ${e.message}")
            } catch (e: Exception) {
                result.put("cancelled", true)
                result.put("uri", null)
                result.put("path", null)
                result.put("error", "Error: ${e.message}")
            }
        }

        invoke.resolve(result)
        pendingInvoke = null
    }

    private fun extractPathFromUri(uri: Uri): String? {
        val path = uri.path ?: return null
        return try {
            when {
                DocumentsContract.isTreeUri(uri) -> {
                    val treeDocId = DocumentsContract.getTreeDocumentId(uri)
                    val split = treeDocId.split(":")
                    if (split[0].equals("primary", ignoreCase = true)) {
                        if (split.size > 1) {
                            Environment.getExternalStorageDirectory().path + "/" + split[1]
                        } else {
                            Environment.getExternalStorageDirectory().path
                        }
                    } else {
                        "/storage/${split[0]}/" + (if (split.size > 1) split[1] else "")
                    }
                }
                else -> null
            }
        } catch (e: Exception) {
            path
        }
    }

    fun triggerEvent(eventName: String, payload: JSObject) {
        activity.runOnUiThread {
            trigger(eventName, payload)
        }
    }

    @Command
    fun update_reading_widget(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateReadingWidgetRequestArgs::class.java)
        pluginScope.launch {
            withContext(Dispatchers.IO) {
                val books = org.json.JSONArray()
                for (book in args.books) {
                    ReadingWidgetStore.writeThumbnail(activity, book.hash, book.coverPath, book.percent)
                    books.put(
                        org.json.JSONObject()
                            .put("hash", book.hash)
                            .put("title", book.title)
                            .put("author", book.author)
                            .put("percent", book.percent)
                    )
                }
                val snapshot = org.json.JSONObject()
                    .put("books", books)
                    .put("sectionTitle", args.sectionTitle)
                    .put("emptyTitle", args.emptyTitle)
                args.tts?.let { tts ->
                    snapshot.put(
                        "tts",
                        org.json.JSONObject()
                            .put("active", tts.active)
                            .put("playing", tts.playing)
                    )
                }
                ReadingWidgetStore.writeSnapshot(activity, snapshot.toString())
            }
            if (isActive) invoke.resolve()
        }
    }

    // ── Sync passphrase keychain ──────────────────────────────────────
    // Backed by EncryptedSharedPreferences, which derives an AES-GCM
    // master key from AndroidKeystore and stores the value-of-keys map
    // in a private SharedPreferences file. The TS-side CryptoSession
    // reads/writes via these commands so the user's sync passphrase
    // persists across app launches.

    private val syncPrefsName = "readest_sync_passphrase_v1"
    private val syncPrefsKey = "passphrase"

    private fun openSyncPrefs(): android.content.SharedPreferences {
        val masterKey = androidx.security.crypto.MasterKey.Builder(activity)
            .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
            .build()
        return androidx.security.crypto.EncryptedSharedPreferences.create(
            activity,
            syncPrefsName,
            masterKey,
            androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Command
    fun set_sync_passphrase(invoke: Invoke) {
        val args = invoke.parseArgs(SyncPassphraseSetArgs::class.java)
        val ret = JSObject()
        try {
            val prefs = openSyncPrefs()
            prefs.edit().putString(syncPrefsKey, args.passphrase).apply()
            ret.put("success", true)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "set_sync_passphrase failed", e)
            ret.put("success", false)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_sync_passphrase(invoke: Invoke) {
        val ret = JSObject()
        try {
            val prefs = openSyncPrefs()
            val value = prefs.getString(syncPrefsKey, null)
            if (value != null) ret.put("passphrase", value)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "get_sync_passphrase failed", e)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    @Command
    fun clear_sync_passphrase(invoke: Invoke) {
        val ret = JSObject()
        try {
            val prefs = openSyncPrefs()
            prefs.edit().remove(syncPrefsKey).apply()
            ret.put("success", true)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "clear_sync_passphrase failed", e)
            ret.put("success", false)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    @Command
    fun is_sync_keychain_available(invoke: Invoke) {
        val ret = JSObject()
        try {
            // Probe by opening the prefs file. Failure surfaces as
            // available=false with the underlying error string so the
            // TS layer can fall back to the ephemeral store.
            openSyncPrefs()
            ret.put("available", true)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "is_sync_keychain_available failed", e)
            ret.put("available", false)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    // ── Keyed secure key-value store ──────────────────────────────────
    // Same EncryptedSharedPreferences backing as the sync passphrase, but
    // a generic keyed store (one prefs file, the caller's `key` as the
    // entry key) so secrets like the Google Drive token set persist the
    // same way without each needing its own command.

    private val secureItemsPrefsName = "readest_secure_items_v1"

    private fun openSecureItemsPrefs(): android.content.SharedPreferences {
        val masterKey = androidx.security.crypto.MasterKey.Builder(activity)
            .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
            .build()
        return androidx.security.crypto.EncryptedSharedPreferences.create(
            activity,
            secureItemsPrefsName,
            masterKey,
            androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    @Command
    fun set_secure_item(invoke: Invoke) {
        val args = invoke.parseArgs(SecureItemSetArgs::class.java)
        val ret = JSObject()
        try {
            openSecureItemsPrefs().edit().putString(args.key, args.value).apply()
            ret.put("success", true)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "set_secure_item failed", e)
            ret.put("success", false)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    @Command
    fun get_secure_item(invoke: Invoke) {
        val args = invoke.parseArgs(SecureItemGetArgs::class.java)
        val ret = JSObject()
        try {
            val value = openSecureItemsPrefs().getString(args.key, null)
            if (value != null) ret.put("value", value)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "get_secure_item failed", e)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    @Command
    fun clear_secure_item(invoke: Invoke) {
        val args = invoke.parseArgs(SecureItemGetArgs::class.java)
        val ret = JSObject()
        try {
            openSecureItemsPrefs().edit().remove(args.key).apply()
            ret.put("success", true)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "clear_secure_item failed", e)
            ret.put("success", false)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    /**
     * Hand a selected word off to whatever dictionary / lookup app the
     * user has installed, via the standard `ACTION_PROCESS_TEXT`
     * intent (Android 6.0+). This is the same dispatch the system
     * "selection toolbar" uses for "Translate" / "Define" actions, so
     * any third-party dictionary that registers the intent (ColorDict,
     * GoldenDict, 欧路词典, Pleco, etc.) shows up without extra work on
     * our side.
     *
     * Routing is decided by [decideLookupDispatch], which filters out
     * web browsers so an OEM browser that registers `ACTION_PROCESS_TEXT`
     * (VIVO / iQOO OriginOS — issue #4559) can't swallow the lookup:
     *
     * - **No browser among the handlers** → dispatch implicitly, exactly
     *   as before. A single handler goes straight through; multiple
     *   handlers raise the system disambiguation dialog with its native
     *   "Just once / Always" buttons.
     * - **Browser + a single dictionary** → launch the dictionary
     *   directly (explicit component), bypassing the browser default.
     * - **Browser + several dictionaries** → show a chooser that excludes
     *   the browser(s) and remember whichever dictionary the user taps
     *   (see [startBrowserExcludingChooser] / [LookupChoiceReceiver]) so
     *   later lookups launch it directly.
     * - **Only a browser (no dictionary installed)** → returns
     *   `unavailable: true` so the TS layer hints to install a dictionary
     *   instead of dumping the user into the browser.
     */
    @Command
    fun show_lookup_popover(invoke: Invoke) {
        val args = invoke.parseArgs(ShowLookupPopoverArgs::class.java)
        val word = args.word?.trim().orEmpty()
        if (word.isEmpty()) {
            return invoke.reject("empty word")
        }

        val intent = Intent(Intent.ACTION_PROCESS_TEXT).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_PROCESS_TEXT, word)
            // Read-only — we don't want third-party apps writing
            // back into a clipboard or selection slot we don't own.
            putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
        }

        pluginScope.launch {
            try {
                // queryIntentActivities/queryBrowserPackages scan installed-app
                // manifests (50–200ms) and readRememberedDictionary touches
                // disk; keep them off the plugin command thread so other plugin
                // IPC isn't queued behind a dictionary lookup. The dispatch
                // itself (startActivity) hops back to Main below.
                val (dispatch, remembered) = withContext(Dispatchers.IO) {
                    val pm = activity.packageManager
                    val handlers = pm.queryIntentActivities(intent, 0).map {
                        LookupHandler(it.activityInfo.packageName, it.activityInfo.name)
                    }
                    val browserPackages = queryBrowserPackages(pm)
                    val remembered = readRememberedDictionary()
                    decideLookupDispatch(handlers, browserPackages, remembered) to remembered
                }
                if (!isActive) return@launch

                when (dispatch) {
                    is LookupDispatch.Unavailable -> {
                        val ret = JSObject()
                        ret.put("success", false)
                        ret.put("unavailable", true)
                        invoke.resolve(ret)
                        return@launch
                    }
                    // FLAG_ACTIVITY_NEW_TASK is required because `activity`
                    // here is the plugin's host activity context — without it
                    // some OEM ROMs reject the dispatch with "Calling
                    // startActivity() from outside of an Activity context".
                    is LookupDispatch.DispatchImplicit -> {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        activity.startActivity(intent)
                    }
                    is LookupDispatch.DispatchExplicit -> {
                        intent.setClassName(dispatch.handler.packageName, dispatch.handler.className)
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        activity.startActivity(intent)
                    }
                    is LookupDispatch.DispatchChooser -> {
                        // We only reach here when the remembered app (if any)
                        // was stale — otherwise it would have been launched
                        // directly. Drop it so a fresh pick replaces it.
                        if (remembered != null) clearRememberedDictionary()
                        startBrowserExcludingChooser(intent, dispatch.exclude)
                    }
                }

                val ret = JSObject()
                ret.put("success", true)
                invoke.resolve(ret)
            } catch (e: Exception) {
                Log.e("NativeBridgePlugin", "show_lookup_popover failed", e)
                if (isActive) invoke.reject("Failed to look up word: ${e.message}")
            }
        }
    }

    /**
     * Package names of installed web browsers — apps with an activity
     * that handles a web `ACTION_VIEW` + `CATEGORY_BROWSABLE` intent.
     * Such apps are always visible under Android 11+ package-visibility
     * rules, so no extra `<queries>` entry is needed here.
     */
    private fun queryBrowserPackages(pm: PackageManager): Set<String> {
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
        return pm.queryIntentActivities(probe, 0)
            .map { it.activityInfo.packageName }
            .toSet()
    }

    private fun lookupPrefs() =
        activity.getSharedPreferences(LOOKUP_PREFS_NAME, Context.MODE_PRIVATE)

    private fun readRememberedDictionary(): LookupHandler? {
        val prefs = lookupPrefs()
        val pkg = prefs.getString(LOOKUP_PREF_PACKAGE, null) ?: return null
        val cls = prefs.getString(LOOKUP_PREF_CLASS, null) ?: return null
        return LookupHandler(pkg, cls)
    }

    private fun clearRememberedDictionary() {
        lookupPrefs().edit().remove(LOOKUP_PREF_PACKAGE).remove(LOOKUP_PREF_CLASS).apply()
    }

    /**
     * Show the system chooser for [target] with the browser [exclude]
     * components filtered out (`EXTRA_EXCLUDE_COMPONENTS`, API 24+), and
     * register an `IntentSender` so the user's pick comes back via
     * [LookupChoiceReceiver] and is remembered. `ACTION_CHOOSER` has no
     * native "Always" button, so this re-implements that affordance.
     */
    private fun startBrowserExcludingChooser(target: Intent, exclude: List<LookupHandler>) {
        val callback = Intent(activity, LookupChoiceReceiver::class.java)
        // FLAG_MUTABLE so the system can fill in EXTRA_CHOSEN_COMPONENT on Android 12+.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
        val pending = PendingIntent.getBroadcast(activity, 0, callback, flags)

        val chooser = Intent.createChooser(target, null, pending.intentSender).apply {
            putExtra(
                Intent.EXTRA_EXCLUDE_COMPONENTS,
                exclude.map { ComponentName(it.packageName, it.className) }.toTypedArray(),
            )
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(chooser)
    }

    /**
     * Report the dictionary app currently remembered for the
     * browser-excluding chooser (see [show_lookup_popover]), so the
     * settings UI can offer a "reset" affordance. Resolves with
     * `{ packageName, label }` when one is remembered and still
     * installed, or `{}` otherwise (clearing a stale entry on the way).
     */
    @Command
    fun get_lookup_dictionary(invoke: Invoke) {
        val ret = JSObject()
        val remembered = readRememberedDictionary() ?: return invoke.resolve(ret)
        try {
            val pm = activity.packageManager
            val appInfo = pm.getApplicationInfo(remembered.packageName, 0)
            ret.put("packageName", remembered.packageName)
            ret.put("label", pm.getApplicationLabel(appInfo).toString())
        } catch (e: PackageManager.NameNotFoundException) {
            // App was uninstalled — drop the stale memory and report none.
            clearRememberedDictionary()
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "get_lookup_dictionary failed", e)
        }
        invoke.resolve(ret)
    }

    /** Forget the remembered dictionary app so the next lookup re-prompts. */
    @Command
    fun clear_lookup_dictionary(invoke: Invoke) {
        val ret = JSObject()
        try {
            clearRememberedDictionary()
            ret.put("success", true)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "clear_lookup_dictionary failed", e)
            ret.put("success", false)
            ret.put("error", e.message ?: "unknown")
        }
        invoke.resolve(ret)
    }

    /**
     * Open a full-screen `WebView` at the supplied URL, capture
     * `document.documentElement.outerHTML` once the page settles, and
     * resolve with `{ html }`. Implements the Android half of the
     * `clip_url` command — see `clip_url.rs` for the desktop half and
     * `ClipUrlController.kt` for the actual lifecycle.
     */
    @Command
    fun clip_url(invoke: Invoke) {
        val args = try {
            invoke.parseArgs(ClipUrlArgs::class.java)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Invalid clip_url args")
            return
        }
        val controller = ClipUrlController(activity, args) { result ->
            when (result) {
                is ClipUrlResult.Success -> {
                    val ret = JSObject()
                    ret.put("html", result.html)
                    invoke.resolve(ret)
                }
                is ClipUrlResult.Failure -> invoke.reject(result.message)
            }
        }
        controller.show()
    }

    /**
     * Trigger a deep e-ink full screen refresh (GC16 waveform) to clear
     * ghosting. Driven by the page-turner "Refresh Page" action on e-ink
     * Android devices. Runs on the UI thread against the window's decor view;
     * [EinkRefreshController] probes each vendor mechanism and resolves
     * `success: false` (not an error) when none is available.
     */
    @Command
    fun refresh_eink_screen(invoke: Invoke) {
        activity.runOnUiThread {
            val ret = JSObject()
            try {
                val view = activity.window?.decorView
                val ok = view != null && EinkRefreshController.refresh(view)
                ret.put("success", ok)
            } catch (e: Exception) {
                Log.e("NativeBridgePlugin", "refresh_eink_screen failed", e)
                ret.put("success", false)
                ret.put("error", e.message ?: "unknown")
            }
            invoke.resolve(ret)
        }
    }

    /**
     * Snapshot a region of the webview for the mesh page-curl texture
     * (readest#555). The rect arrives in CSS pixels of the JS viewport;
     * scaling by the display density (devicePixelRatio) maps it to window
     * pixels. PixelCopy reads back from the window surface, which includes
     * the hardware-accelerated WebView that View.draw would miss. Resolved
     * as base64 because the plugin boundary is JSON-only; the Rust side
     * decodes back to bytes.
     *
     * The result is JPEG, not PNG: a full-screen 3x PNG took ~1.5s to
     * encode per page turn on a Xiaomi 13, which read as the curl not
     * working at all. The page is opaque so JPEG loses nothing visible,
     * and the destination bitmap is capped at 2x CSS pixels — PixelCopy
     * scales into a smaller bitmap for free and the moving page stays
     * visually sharp.
     */
    @Command
    fun capture_webview_region(invoke: Invoke) {
        val args = invoke.parseArgs(CaptureWebviewRegionArgs::class.java)
        val webView = webViewRef
        val window = activity.window
        if (webView == null || window == null) {
            invoke.reject("WebView not available")
            return
        }
        activity.runOnUiThread {
            val density = webView.resources.displayMetrics.density
            val location = IntArray(2)
            webView.getLocationInWindow(location)
            val left = location[0] + (args.x * density).toInt()
            val top = location[1] + (args.y * density).toInt()
            val width = (args.width * density).toInt()
            val height = (args.height * density).toInt()
            if (width <= 0 || height <= 0) {
                invoke.reject("Empty capture region")
                return@runOnUiThread
            }
            val captureScale = minOf(density, 2f)
            val destWidth = (args.width * captureScale).toInt()
            val destHeight = (args.height * captureScale).toInt()
            val bitmap = Bitmap.createBitmap(destWidth, destHeight, Bitmap.Config.ARGB_8888)
            try {
                PixelCopy.request(
                    window,
                    Rect(left, top, left + width, top + height),
                    bitmap,
                    { result ->
                        if (result == PixelCopy.SUCCESS) {
                            // Encode off the main thread; ~100ms of work for
                            // a full-screen 2x JPEG.
                            pluginScope.launch {
                                val data = withContext(Dispatchers.IO) {
                                    val out = ByteArrayOutputStream()
                                    bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                                    Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                                }
                                invoke.resolve(JSObject().put("data", data))
                            }
                        } else {
                            invoke.reject("PixelCopy failed: $result")
                        }
                    },
                    Handler(Looper.getMainLooper())
                )
            } catch (e: IllegalArgumentException) {
                // Thrown when the rect falls outside the window bounds.
                invoke.reject("Capture region out of bounds: ${e.message}")
            }
        }
    }
}

@app.tauri.annotation.InvokeArg
class SyncPassphraseSetArgs {
    lateinit var passphrase: String
}

@app.tauri.annotation.InvokeArg
class SecureItemSetArgs {
    lateinit var key: String
    lateinit var value: String
}

@app.tauri.annotation.InvokeArg
class SecureItemGetArgs {
    lateinit var key: String
}
