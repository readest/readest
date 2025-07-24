import StoreKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "StoreKitManager")

class StoreKitManager: NSObject, SKProductsRequestDelegate, SKPaymentTransactionObserver {
  static let shared = StoreKitManager()

  private var productsRequest: SKProductsRequest?
  private var productResponseHandler: (([SKProduct]) -> Void)?
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
    let ids = Set(productIds)
    productsRequest = SKProductsRequest(productIdentifiers: ids)
    productsRequest?.delegate = self
    productResponseHandler = completion
    productsRequest?.start()
  }

  func purchase(
    product: SKProduct, completion: @escaping (Result<SKPaymentTransaction, Error>) -> Void
  ) {
    guard SKPaymentQueue.canMakePayments() else {
      completion(
        .failure(
          NSError(
            domain: "iap", code: 0, userInfo: [NSLocalizedDescriptionKey: "Purchases disabled."])))
      return
    }
    purchaseHandler = completion
    let payment = SKPayment(product: product)
    SKPaymentQueue.default().add(payment)
  }

  func restorePurchases(completion: @escaping ([SKPaymentTransaction]) -> Void) {
    restoreHandler = completion
    SKPaymentQueue.default().restoreCompletedTransactions()
  }

  // MARK: - SKProductsRequestDelegate
  func productsRequest(_ request: SKProductsRequest, didReceive response: SKProductsResponse) {
    DispatchQueue.main.async { [weak self] in
      self?.productResponseHandler?(response.products)
      self?.productResponseHandler = nil
    }
  }

  func request(_ request: SKRequest, didFailWithError error: Error) {
    DispatchQueue.main.async { [weak self] in
      logger.error("Products request failed: \(error.localizedDescription)")
      self?.productResponseHandler?([])
      self?.productResponseHandler = nil
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
