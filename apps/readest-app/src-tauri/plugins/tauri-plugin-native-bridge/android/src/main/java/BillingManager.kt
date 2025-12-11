package com.readest.native_bridge

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.ConnectionResult
import java.text.SimpleDateFormat
import java.util.*

class BillingManager(private val activity: Activity) : PurchasesUpdatedListener {
    private lateinit var billingClient: BillingClient
    private val productsCache = mutableMapOf<String, ProductDetails>()
    private var purchaseCallback: ((PurchaseData?) -> Unit)? = null
    private val scope = CoroutineScope(Dispatchers.Main)
    private val isGooglePlayAvailable: Boolean by lazy {
        val availability = GoogleApiAvailability.getInstance()
        val resultCode = availability.isGooglePlayServicesAvailable(activity)
        resultCode == ConnectionResult.SUCCESS
    }
    
    companion object {
        private const val TAG = "BillingManager"
    }

    fun isBillingAvailable(): Boolean {
        return isGooglePlayAvailable
    }

    fun initialize(callback: (Boolean) -> Unit) {
        if (!isGooglePlayAvailable) {
            Log.d(TAG, "Google Play Services not available, skipping billing setup")
            callback(false)
            return
        }

        billingClient = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases()
            .build()

        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client setup finished successfully")
                    callback(true)
                } else {
                    Log.e(TAG, "Billing setup failed: ${billingResult.debugMessage}")
                    callback(false)
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected")
                // Try to reconnect
                initialize { }
            }
        })
    }

    fun fetchProducts(productIds: List<String>, callback: (List<ProductData>) -> Unit) {
        if (!::billingClient.isInitialized || !billingClient.isReady) {
            Log.e(TAG, "Billing client not ready")
            callback(emptyList())
            return
        }

        scope.launch {
            val products = mutableListOf<ProductData>()
            
            // Check for subscription products
            val subsIds = productIds.filter { 
                it.contains("monthly") || it.contains("yearly") || it.contains("subscription")
            }
            
            if (subsIds.isNotEmpty()) {
                fetchProductsOfType(subsIds, BillingClient.ProductType.SUBS) { subProducts ->
                    products.addAll(subProducts)
                    
                    // Then fetch in-app products
                    val inAppIds = productIds - subsIds.toSet()
                    if (inAppIds.isNotEmpty()) {
                        fetchProductsOfType(inAppIds, BillingClient.ProductType.INAPP) { inAppProducts ->
                            products.addAll(inAppProducts)
                            callback(products)
                        }
                    } else {
                        callback(products)
                    }
                }
            } else {
                // Only in-app products
                fetchProductsOfType(productIds, BillingClient.ProductType.INAPP) { inAppProducts ->
                    products.addAll(inAppProducts)
                    callback(products)
                }
            }
        }
    }

    private fun fetchProductsOfType(
        productIds: List<String>, 
        productType: String, 
        callback: (List<ProductData>) -> Unit
    ) {
        val productList = productIds.map { productId ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(productType)
                .build()
        }

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build()

        billingClient.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                val products = productDetailsList.map { productDetails ->
                    // Cache for purchase later
                    productsCache[productDetails.productId] = productDetails
                    
                    when (productType) {
                        BillingClient.ProductType.SUBS -> {
                            val offer = productDetails.subscriptionOfferDetails?.firstOrNull()
                            val pricingPhase = offer?.pricingPhases?.pricingPhaseList?.firstOrNull()
                            
                            pricingPhase?.let {
                                ProductData(
                                    id = productDetails.productId,
                                    title = productDetails.title,
                                    description = productDetails.description,
                                    price = it.formattedPrice,
                                    priceCurrencyCode = it.priceCurrencyCode,
                                    priceAmountMicros = it.priceAmountMicros,
                                    productType = "subscription"
                                )
                            }
                        }
                        BillingClient.ProductType.INAPP -> {
                            val oneTimeOffer = productDetails.oneTimePurchaseOfferDetails
                            
                            oneTimeOffer?.let {
                                ProductData(
                                    id = productDetails.productId,
                                    title = productDetails.title,
                                    description = productDetails.description,
                                    price = it.formattedPrice,
                                    priceCurrencyCode = it.priceCurrencyCode,
                                    priceAmountMicros = it.priceAmountMicros,
                                    productType = "consumable"
                                )
                            }
                        }
                        else -> null
                    }
                }.filterNotNull()
                callback(products)
            } else {
                Log.e(TAG, "Failed to fetch products: ${billingResult.debugMessage}")
                callback(emptyList())
            }
        }
    }

    fun purchaseProduct(productId: String, callback: (PurchaseData?) -> Unit) {
        val productDetails = productsCache[productId]
        if (productDetails == null) {
            Log.e(TAG, "Product not found in cache: $productId")
            callback(null)
            return
        }

        purchaseCallback = callback

        val productDetailsParamsList = listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(productDetails)
                .apply {
                    // For subscriptions, use the first offer
                    productDetails.subscriptionOfferDetails?.firstOrNull()?.let { offer ->
                        setOfferToken(offer.offerToken)
                    }
                }
                .build()
        )

        val billingFlowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(productDetailsParamsList)
            .build()

        val billingResult = billingClient.launchBillingFlow(activity, billingFlowParams)
        
        if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.e(TAG, "Failed to launch billing flow: ${billingResult.debugMessage}")
            callback(null)
            purchaseCallback = null
        }
    }

    fun restorePurchases(callback: (List<PurchaseData>) -> Unit) {
        if (!::billingClient.isInitialized || !billingClient.isReady) {
            Log.e(TAG, "Billing client not ready")
            callback(emptyList())
            return
        }

        scope.launch {
            val allPurchases = mutableListOf<PurchaseData>()
            
            // Query in-app purchases
            val inappParams = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
                
            billingClient.queryPurchasesAsync(inappParams) { billingResult, purchases ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    allPurchases.addAll(purchases.map { purchase ->
                        convertToPurchaseData(purchase, "restored")
                    })
                }
                
                // Query subscription purchases
                val subsParams = QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
                    
                billingClient.queryPurchasesAsync(subsParams) { billingResult, purchases ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        allPurchases.addAll(purchases.map { purchase ->
                            convertToPurchaseData(purchase, "restored")
                        })
                    }
                    
                    callback(allPurchases)
                }
            }
        }
    }

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: List<Purchase>?) {
        when (billingResult.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach { purchase ->
                    handlePurchase(purchase)
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> {
                Log.d(TAG, "Purchase cancelled by user")
                purchaseCallback?.invoke(null)
                purchaseCallback = null
            }
            else -> {
                Log.e(TAG, "Purchase failed: ${billingResult.debugMessage}")
                purchaseCallback?.invoke(null)
                purchaseCallback = null
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        // Acknowledge the purchase
        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
            if (!purchase.isAcknowledged) {
                val acknowledgePurchaseParams = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.purchaseToken)
                    .build()
                    
                billingClient.acknowledgePurchase(acknowledgePurchaseParams) { billingResult ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        Log.d(TAG, "Purchase acknowledged")
                    }
                }
            }
            
            val purchaseData = convertToPurchaseData(purchase, "purchased")
            purchaseCallback?.invoke(purchaseData)
            purchaseCallback = null
        }
    }

    private fun convertToPurchaseData(purchase: Purchase, state: String): PurchaseData {
        val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        dateFormat.timeZone = TimeZone.getTimeZone("UTC")
        
        return PurchaseData(
            platform = "android",
            productId = purchase.products.firstOrNull() ?: "",
            orderId = purchase.orderId ?: purchase.purchaseToken,
            purchaseToken = purchase.purchaseToken,
            purchaseDate = dateFormat.format(Date(purchase.purchaseTime)),
            purchaseState = state,
        )
    }
}