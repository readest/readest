package com.readest.native_bridge

import android.app.Activity
import android.util.Log
import com.android.billingclient.api.*
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

internal const val MAX_BILLING_QUERY_ATTEMPTS = 3
private const val BILLING_QUERY_RETRY_DELAY_MS = 2_000L

internal fun shouldRetryBillingQuery(responseCode: Int, attempt: Int): Boolean {
    return responseCode == BillingClient.BillingResponseCode.SERVICE_DISCONNECTED &&
        attempt < MAX_BILLING_QUERY_ATTEMPTS
}

internal class BillingSetupState {
    private var setupComplete = false
    private var setupInProgress = false
    private val callbacks = mutableListOf<(Boolean) -> Unit>()

    fun awaitSetup(startSetup: () -> Unit, callback: (Boolean) -> Unit) {
        var shouldStart = false
        val alreadyComplete = synchronized(this) {
            if (setupComplete) return@synchronized true

            callbacks.add(callback)
            if (!setupInProgress) {
                setupInProgress = true
                shouldStart = true
            }
            false
        }

        if (alreadyComplete) {
            callback(true)
        } else if (shouldStart) {
            startSetup()
        }
    }

    fun complete(success: Boolean) {
        val pendingCallbacks = synchronized(this) {
            setupInProgress = false
            setupComplete = success
            callbacks.toList().also { callbacks.clear() }
        }
        pendingCallbacks.forEach { it(success) }
    }
}

class BillingManager(private val activity: Activity) : PurchasesUpdatedListener {
    private lateinit var billingClient: BillingClient
    private val setupState = BillingSetupState()
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

        setupState.awaitSetup(::startBillingConnection, callback)
    }

    private fun startBillingConnection() {
        if (!::billingClient.isInitialized) {
            billingClient = BillingClient.newBuilder(activity)
                .setListener(this)
                .enablePendingPurchases(
                    PendingPurchasesParams.newBuilder()
                        .enableOneTimeProducts()
                        .build()
                )
                .enableAutoServiceReconnection()
                .build()
        }

        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client setup finished successfully")
                    setupState.complete(true)
                } else {
                    Log.e(TAG, "Billing setup failed: ${billingResult.debugMessage}")
                    setupState.complete(false)
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected; waiting for automatic reconnection")
            }
        })
    }

    fun fetchProducts(productIds: List<String>, callback: (List<ProductData>) -> Unit) {
        initialize { setupSucceeded ->
            if (!setupSucceeded) {
                Log.e(TAG, "Billing client setup did not complete")
                callback(emptyList())
                return@initialize
            }

            scope.launch {
                val products = mutableListOf<ProductData>()

                // Check for subscription products
                val subsIds = productIds.filter {
                    it.contains("monthly") || it.contains("yearly") || it.contains("subscription")
                }

                if (subsIds.isNotEmpty()) {
                    fetchProductsOfType(
                        subsIds,
                        BillingClient.ProductType.SUBS
                    ) { subProducts ->
                        products.addAll(subProducts)

                        // Then fetch in-app products
                        val inAppIds = productIds - subsIds.toSet()
                        if (inAppIds.isNotEmpty()) {
                            fetchProductsOfType(
                                inAppIds,
                                BillingClient.ProductType.INAPP
                            ) { inAppProducts ->
                                products.addAll(inAppProducts)
                                callback(products)
                            }
                        } else {
                            callback(products)
                        }
                    }
                } else {
                    // Only in-app products
                    fetchProductsOfType(
                        productIds,
                        BillingClient.ProductType.INAPP
                    ) { inAppProducts ->
                        products.addAll(inAppProducts)
                        callback(products)
                    }
                }
            }
        }
    }

    private fun fetchProductsOfType(
        productIds: List<String>,
        productType: String,
        attempt: Int = 1,
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

        billingClient.queryProductDetailsAsync(params) { billingResult, queryResult ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                val products = queryResult.productDetailsList.map { productDetails ->
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
            } else if (shouldRetryBillingQuery(billingResult.responseCode, attempt)) {
                Log.w(TAG, "Billing service disconnected while fetching products; retrying")
                scheduleQueryRetry {
                    fetchProductsOfType(productIds, productType, attempt + 1, callback)
                }
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
        initialize { setupSucceeded ->
            if (!setupSucceeded) {
                Log.e(TAG, "Billing client setup did not complete")
                callback(emptyList())
                return@initialize
            }

            scope.launch {
                val allPurchases = mutableListOf<PurchaseData>()

                queryPurchases(BillingClient.ProductType.INAPP) { inAppPurchases ->
                    allPurchases.addAll(inAppPurchases.map { purchase ->
                        convertToPurchaseData(purchase, "restored")
                    })

                    queryPurchases(BillingClient.ProductType.SUBS) { subscriptionPurchases ->
                        allPurchases.addAll(subscriptionPurchases.map { purchase ->
                            convertToPurchaseData(purchase, "restored")
                        })

                        callback(allPurchases)
                    }
                }
            }
        }
    }

    private fun queryPurchases(
        productType: String,
        attempt: Int = 1,
        callback: (List<Purchase>) -> Unit
    ) {
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(productType)
            .build()

        billingClient.queryPurchasesAsync(params) { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                callback(purchases)
            } else if (shouldRetryBillingQuery(billingResult.responseCode, attempt)) {
                Log.w(TAG, "Billing service disconnected while restoring purchases; retrying")
                scheduleQueryRetry {
                    queryPurchases(productType, attempt + 1, callback)
                }
            } else {
                Log.e(TAG, "Failed to restore purchases: ${billingResult.debugMessage}")
                callback(emptyList())
            }
        }
    }

    private fun scheduleQueryRetry(query: () -> Unit) {
        scope.launch {
            delay(BILLING_QUERY_RETRY_DELAY_MS)
            query()
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
        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
            // Only subscriptions are acknowledged here. One-time products are
            // consumables that the server consumes after verification (consume
            // implies acknowledge); an unverified purchase must stay
            // unacknowledged so Google Play auto-refunds it after 3 days.
            if (isSubscriptionPurchase(purchase) && !purchase.isAcknowledged) {
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

    private fun isSubscriptionPurchase(purchase: Purchase): Boolean {
        val productId = purchase.products.firstOrNull() ?: return false
        val cached = productsCache[productId]
        if (cached != null) {
            return cached.productType == BillingClient.ProductType.SUBS
        }
        return productId.contains("monthly") || productId.contains("yearly") ||
            productId.contains("subscription")
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
