package com.readest.native_bridge

import android.app.Activity
import android.util.Log

class BillingManager(private val activity: Activity) {
    companion object {
        private const val TAG = "BillingManager"
    }

    fun isBillingAvailable(): Boolean {
        return false
    }

    fun initialize(callback: (Boolean) -> Unit) {
        Log.d(TAG, "Google Play billing not available in this build")
        callback(false)
    }

    fun fetchProducts(productIds: List<String>, callback: (List<ProductData>) -> Unit) {
        callback(emptyList())
    }

    fun purchaseProduct(productId: String, callback: (PurchaseData?) -> Unit) {
        callback(null)
    }

    fun restorePurchases(callback: (List<PurchaseData>) -> Unit) {
        callback(emptyList())
    }
}
