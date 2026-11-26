import StoreKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "StoreKitManager")

class StoreKitManager: NSObject, SKProductsRequestDelegate, SKPaymentTransactionObserver {
  static let shared = StoreKitManager()

  // One completion per request. The account page fetches its plans and the
  // gift card prices at the same time; a single shared handler gave one caller
  // the other's products and left the other waiting forever.
  private var productRequests: [SKProductsRequest: ([SKProduct]) -> Void] = [:]
  private var purchaseHandler: ((Result<SKPaymentTransaction, Error>) -> Void)?
  private var restoreHandler: (([SKPaymentTransaction]) -> Void)?

  private override init() {
    super.init()
  }

  func initialize() {
    SKPaymentQueue.default().add(self)
  }

  deinit {
    SKPaymentQueue.default().remove(self)
  }

  func fetchProducts(productIds: [String], completion: @escaping ([SKProduct]) -> Void) {
    DispatchQueue.main.async { [self] in
      let request = SKProductsRequest(productIdentifiers: Set(productIds))
      request.delegate = self
      productRequests[request] = completion
      request.start()
    }
  }

  func purchase(
    product: SKProduct, appAccountToken: String? = nil,
    completion: @escaping (Result<SKPaymentTransaction, Error>) -> Void
  ) {
    guard SKPaymentQueue.canMakePayments() else {
      completion(
        .failure(
          NSError(
            domain: "iap", code: 0, userInfo: [NSLocalizedDescriptionKey: "Purchases disabled."])))
      return
    }
    purchaseHandler = completion
    let payment = SKMutablePayment(product: product)
    // StoreKit 1 surfaces `applicationUsername` as the transaction's
    // `appAccountToken`, which is how a purchase is attributed to a user
    // server-side. The App Store only propagates it when it is a valid UUID,
    // so send nothing rather than a malformed value.
    if let token = appAccountToken, UUID(uuidString: token) != nil {
      payment.applicationUsername = token
    }
    SKPaymentQueue.default().add(payment)
  }

  func restorePurchases(completion: @escaping ([SKPaymentTransaction]) -> Void) {
    restoreHandler = completion
    SKPaymentQueue.default().restoreCompletedTransactions()
  }

  // MARK: - SKProductsRequestDelegate
  func productsRequest(_ request: SKProductsRequest, didReceive response: SKProductsResponse) {
    DispatchQueue.main.async { [weak self] in
      self?.productRequests.removeValue(forKey: request)?(response.products)
    }
  }

  func request(_ request: SKRequest, didFailWithError error: Error) {
    DispatchQueue.main.async { [weak self] in
      logger.error("Products request failed: \(error.localizedDescription)")
      guard let request = request as? SKProductsRequest else { return }
      self?.productRequests.removeValue(forKey: request)?([])
    }
  }

  // MARK: - SKPaymentTransactionObserver
  func paymentQueue(
    _ queue: SKPaymentQueue, updatedTransactions transactions: [SKPaymentTransaction]
  ) {
    for transaction in transactions {
      switch transaction.transactionState {
      case .purchased:
        SKPaymentQueue.default().finishTransaction(transaction)
        DispatchQueue.main.async { [weak self] in
          self?.purchaseHandler?(.success(transaction))
          self?.purchaseHandler = nil
        }
      case .failed:
        SKPaymentQueue.default().finishTransaction(transaction)
        let error =
          transaction.error
          ?? NSError(
            domain: "iap", code: -1, userInfo: [NSLocalizedDescriptionKey: "Unknown purchase error"]
          )
        DispatchQueue.main.async { [weak self] in
          self?.purchaseHandler?(.failure(error))
          self?.purchaseHandler = nil
        }
      case .restored:
        SKPaymentQueue.default().finishTransaction(transaction)
      case .deferred, .purchasing:
        // Handle these states if needed
        break
      @unknown default:
        break
      }
    }
  }

  func paymentQueueRestoreCompletedTransactionsFinished(_ queue: SKPaymentQueue) {
    let restored = queue.transactions.filter { $0.transactionState == .restored }
    DispatchQueue.main.async { [weak self] in
      self?.restoreHandler?(restored)
      self?.restoreHandler = nil
    }
  }

  func paymentQueue(
    _ queue: SKPaymentQueue, restoreCompletedTransactionsFailedWithError error: Error
  ) {
    DispatchQueue.main.async { [weak self] in
      logger.error("Restore purchases failed: \(error.localizedDescription)")
      self?.restoreHandler?([])
      self?.restoreHandler = nil
    }
  }
}
