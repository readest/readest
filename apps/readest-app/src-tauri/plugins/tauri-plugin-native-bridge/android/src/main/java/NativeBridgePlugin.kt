package com.readest.native_bridge

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
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
import android.graphics.Color
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
    private val billingManager by lazy {
        BillingManager(activity)
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
            if (uri.scheme == "readest" && uri.host == "auth-callback") {
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

    private fun emitSharedIntent(action: String, uris: List<Uri>) {
        val payload = JSObject().apply {
            put("action", action)
            val arr = JSArray()
            uris.forEach { arr.put(it.toString()) }
            put("urls", arr)
        }
        triggerEvent("shared-intent", payload)
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
        val ret = JSObject()
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
                ret.put("success", true)
            } else {
                ret.put("success", false)
                ret.put("error", "Failed to open input stream from URI")
            }
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
    }

    @Command
    fun install_package(invoke: Invoke) {
        val args = invoke.parseArgs(InstallPackageRequestArgs::class.java)
        val ret = JSObject()
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
                activity.startActivity(intent)
                ret.put("success", true)
            } else {
                ret.put("success", false)
                ret.put("error", "File does not exist")
            }
        } catch (e: Exception) {
            ret.put("success", false)
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
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
        val ret = JSObject()
        try {
            val fontList = mutableListOf<String>()
            val fontFileList = mutableListOf<String>()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val systemFonts = SystemFonts.getAvailableFonts()
                for (font in systemFonts) {
                    val file = font.getFile()?: continue
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
                var fontName = fileFileName
                    .replace(Regex("\\.(ttf|otf)$", RegexOption.IGNORE_CASE), "")
                    .trim()
                fontList.add(fontName)
            }
            var fontDict = JSObject()
            for (fontName in fontList) {
                fontDict.put(fontName, fontName)
            }
            ret.put("fonts", fontDict)
        } catch (e: Exception) {
            ret.put("error", e.message)
        }
        invoke.resolve(ret)
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

    /**
     * Hand a selected word off to whatever dictionary / lookup app the
     * user has installed, via the standard `ACTION_PROCESS_TEXT`
     * intent (Android 6.0+). This is the same dispatch the system
     * "selection toolbar" uses for "Translate" / "Define" actions, so
     * any third-party dictionary that registers the intent (ColorDict,
     * GoldenDict, 欧路, Pleco, etc.) shows up without extra work on
     * our side.
     *
     * Important: we deliberately do NOT wrap the intent with
     * `Intent.createChooser`. Chooser-style dialogs always re-prompt
     * (no "Always use this app" affordance), which the user found
     * annoying when they have a single preferred dictionary. Plain
     * `startActivity(intent)` instead surfaces the standard system
     * disambiguation dialog with the "Just once / Always" buttons —
     * picking "Always" makes subsequent lookups go straight to that
     * app. When only one app handles the intent, Android skips the
     * picker entirely and launches it directly.
     *
     * If no app is installed that responds to the intent, returns
     * `unavailable: true` instead of throwing — the TS layer surfaces
     * a hint rather than a generic error in that case.
     */
    @Command
    fun show_lookup_popover(invoke: Invoke) {
        val args = invoke.parseArgs(ShowLookupPopoverArgs::class.java)
        val word = args.word?.trim().orEmpty()
        if (word.isEmpty()) {
            return invoke.reject("empty word")
        }

        try {
            val intent = Intent(Intent.ACTION_PROCESS_TEXT).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_PROCESS_TEXT, word)
                // Read-only — we don't want third-party apps writing
                // back into a clipboard or selection slot we don't own.
                putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
            }

            // Probe for handlers before dispatching. An ActivityNotFound
            // crash is a worse UX than a quiet "no dictionary app"
            // result; surface the empty case explicitly.
            val pm = activity.packageManager
            val handlers = pm.queryIntentActivities(intent, 0)
            if (handlers.isEmpty()) {
                val ret = JSObject()
                ret.put("success", false)
                ret.put("unavailable", true)
                return invoke.resolve(ret)
            }

            // FLAG_ACTIVITY_NEW_TASK is required because `activity`
            // here is the plugin's host activity context — without it,
            // some OEM ROMs reject the dispatch with "Calling
            // startActivity() from outside of an Activity context".
            // The system disambiguation dialog still appears (with the
            // Always/Just once buttons) for multi-handler cases; for
            // single-handler cases it goes straight through.
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)

            val ret = JSObject()
            ret.put("success", true)
            invoke.resolve(ret)
        } catch (e: Exception) {
            Log.e("NativeBridgePlugin", "show_lookup_popover failed", e)
            invoke.reject("Failed to look up word: ${e.message}")
        }
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
}

@app.tauri.annotation.InvokeArg
class SyncPassphraseSetArgs {
    lateinit var passphrase: String
}
