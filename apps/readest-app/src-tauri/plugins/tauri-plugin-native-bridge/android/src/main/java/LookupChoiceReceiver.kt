package com.readest.native_bridge

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build

/** Plain (non-encrypted) prefs file holding the remembered lookup app. */
internal const val LOOKUP_PREFS_NAME = "readest_lookup_dictionary_v1"
internal const val LOOKUP_PREF_PACKAGE = "package"
internal const val LOOKUP_PREF_CLASS = "class"

/**
 * Receives the `EXTRA_CHOSEN_COMPONENT` callback fired by the
 * browser-excluding dictionary chooser (see
 * [NativeBridgePlugin.show_lookup_popover]). The system reports which
 * activity the user tapped; we persist it so the next lookup launches
 * that dictionary directly instead of re-showing the chooser — the
 * app-managed equivalent of the system's "Always" affordance, which
 * `ACTION_CHOOSER` itself doesn't offer.
 */
class LookupChoiceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val chosen = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_CHOSEN_COMPONENT, ComponentName::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_CHOSEN_COMPONENT) as? ComponentName
        } ?: return

        context.getSharedPreferences(LOOKUP_PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(LOOKUP_PREF_PACKAGE, chosen.packageName)
            .putString(LOOKUP_PREF_CLASS, chosen.className)
            .apply()
    }
}
