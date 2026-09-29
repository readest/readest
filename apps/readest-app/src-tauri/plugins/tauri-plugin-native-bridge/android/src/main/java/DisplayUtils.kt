package com.readest.native_bridge

import android.content.Context

/** dp to px, rounded. */
fun dp(context: Context, units: Int): Int =
    (units * context.resources.displayMetrics.density + 0.5f).toInt()
