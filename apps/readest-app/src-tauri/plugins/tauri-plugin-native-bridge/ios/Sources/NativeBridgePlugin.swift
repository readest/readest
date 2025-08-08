import AVFoundation
import AuthenticationServices
import CoreText
import MediaPlayer
import ObjectiveC
import StoreKit
import SwiftRs
import Tauri
import UIKit
import WebKit
import os

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "NativeBridge")

func getLocalizedDisplayName(familyName: String) -> String? {
  let fontDescriptor = CTFontDescriptorCreateWithAttributes(
    [
      kCTFontFamilyNameAttribute: familyName
    ] as CFDictionary)

  let font = CTFontCreateWithFontDescriptor(fontDescriptor, 0.0, nil)

  var actualLanguage: Unmanaged<CFString>?
  if let localizedName = CTFontCopyLocalizedName(font, kCTFontFamilyNameKey, &actualLanguage) {
    return localizedName as String
  }
  return nil
}

class SafariAuthRequestArgs: Decodable {
  let authUrl: String
}

class UseBackgroundAudioRequestArgs: Decodable {
  let enabled: Bool
}

class SetSystemUIVisibilityRequestArgs: Decodable {
  let visible: Bool
  let darkMode: Bool
}

class InterceptKeysRequestArgs: Decodable {
  let backKey: Bool?
  let volumeKeys: Bool?
}

class LockScreenOrientationRequestArgs: Decodable {
  let orientation: String?
}

struct InitializeRequest: Decodable {
  let publicKey: String?
}

struct FetchProductsRequest: Decodable {
  let productIds: [String]
}

struct PurchaseProductRequest: Decodable {
  let productId: String
}

struct ProductData: Codable {
  let id: String
  let title: String
  let description: String
  let price: String
  let priceCurrencyCode: String?
  let priceAmountMicros: Int64
  let productType: String
}

struct PurchaseData: Codable {
  let productId: String
  let transactionId: String
  let originalTransactionId: String
  let purchaseDate: String
  let purchaseState: String
  let platform: String
}

class VolumeKeyHandler: NSObject {
  private var audioSession: AVAudioSession?
  private var originalVolume: Float = 0.0
  private var referenceVolume: Float = 0.5
  private var previousVolume: Float = 0.5
  private var volumeView: MPVolumeView?
  private(set) var isIntercepting = false
  private var webView: WKWebView?
  private var volumeSlider: UISlider?

  func startInterception(webView: WKWebView) {
    if isIntercepting {
      stopInterception()
    }

    logger.log("Starting volume key interception")
    self.webView = webView
    isIntercepting = true

    audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession?.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try audioSession?.setActive(true)
    } catch {
      logger.error("Failed to activate audio session: \(error)")
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self = self else { return }
      self.originalVolume = self.audioSession?.outputVolume ?? 0.1
      if self.originalVolume > 0.9 {
        self.referenceVolume = 0.9
      } else if self.originalVolume < 0.1 {
        self.referenceVolume = 0.1
      } else {
        self.referenceVolume = self.originalVolume
      }
      logger.log("Reference volume set to \(self.referenceVolume)")
      self.previousVolume = self.referenceVolume
      self.setSessionVolume(self.referenceVolume)
      self.setupHiddenVolumeView()
      self.audioSession?.addObserver(
        self, forKeyPath: "outputVolume", options: [.new], context: nil)
    }

    audioSession?.addObserver(self, forKeyPath: "outputVolume", options: [.new], context: nil)
  }

  func stopInterception() {
    if !isIntercepting {
      return
    }

    logger.log("Stopping volume key interception")
    isIntercepting = false
    audioSession?.removeObserver(self, forKeyPath: "outputVolume")
    DispatchQueue.main.async { [weak self] in
      self?.setSessionVolume(self?.originalVolume ?? 0.1)
      self?.volumeView?.removeFromSuperview()
      self?.volumeView = nil
      self?.volumeSlider = nil
    }
  }

  private func setSessionVolume(_ volume: Float) {
    DispatchQueue.main.async { [weak self] in
      self?.volumeSlider?.value = volume
    }
  }

  private func setupHiddenVolumeView() {
    assert(Thread.isMainThread, "setupHiddenVolumeView must be called on main thread")
    let frame = CGRect(x: -1000, y: -1000, width: 1, height: 1)
    volumeView = MPVolumeView(frame: frame)
    volumeSlider = volumeView?.subviews.first(where: { $0 is UISlider }) as? UISlider
    if let window = UIApplication.shared.windows.first {
      window.addSubview(volumeView!)
    }
  }

  override func observeValue(
    forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?,
    context: UnsafeMutableRawPointer?
  ) {
    if keyPath == "outputVolume", let audioSession = self.audioSession, isIntercepting {
      let currentVolume = audioSession.outputVolume
      if currentVolume > self.previousVolume {
        DispatchQueue.main.async { [weak self] in
          self?.webView?.evaluateJavaScript(
            "window.onNativeKeyDown('VolumeUp');", completionHandler: nil)
        }
      } else if currentVolume < self.previousVolume {
        DispatchQueue.main.async { [weak self] in
          self?.webView?.evaluateJavaScript(
            "window.onNativeKeyDown('VolumeDown');", completionHandler: nil)
        }
      }
      self.previousVolume = currentVolume
      self.setSessionVolume(self.referenceVolume)
    }
  }
}

class NativeBridgePlugin: Plugin {
  private var webView: WKWebView?
  private var authSession: ASWebAuthenticationSession?
  private var currentOrientationMask: UIInterfaceOrientationMask = .all
  private var originalDelegate: UIApplicationDelegate?

  @objc public override func load(webview: WKWebView) {
    self.webView = webview
    logger.log("NativeBridgePlugin loaded")

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )

    if let app = UIApplication.value(forKey: "sharedApplication") as? UIApplication {
      self.originalDelegate = app.delegate
      app.delegate = self
    } else {
      Logger.error("NativeBridgePlugin: Failed to get shared application")
    }
  }

  @objc func appDidBecomeActive() {
    if volumeKeyHandler != nil {
      activateVolumeKeyInterception()
    }
  }

  @objc func appDidEnterBackground() {
    if let handler = volumeKeyHandler, handler.isIntercepting {
      handler.stopInterception()
    }
  }

  func activateVolumeKeyInterception() {
    if volumeKeyHandler == nil {
      volumeKeyHandler = VolumeKeyHandler()
    }

    if let webView = self.webView {
      volumeKeyHandler?.stopInterception()
      volumeKeyHandler?.startInterception(webView: webView)
    } else {
      logger.warning("Cannot activate volume key interception: webView is nil")
    }
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  private struct AssociatedKeys {
    static var volumeKeyHandler = "volumeKeyHandler"
    static var interceptingVolumeKeys = "interceptingVolumeKeys"
  }

  private var volumeKeyHandler: VolumeKeyHandler? {
    get {
      return objc_getAssociatedObject(self, &AssociatedKeys.volumeKeyHandler) as? VolumeKeyHandler
    }
    set {
      objc_setAssociatedObject(
        self, &AssociatedKeys.volumeKeyHandler, newValue, .OBJC_ASSOCIATION_RETAIN)
    }
  }

  private var interceptingVolumeKeys: Bool {
    get {
      return objc_getAssociatedObject(self, &AssociatedKeys.interceptingVolumeKeys) as? Bool
        ?? false
    }
    set {
      objc_setAssociatedObject(
        self, &AssociatedKeys.interceptingVolumeKeys, newValue, .OBJC_ASSOCIATION_RETAIN)
    }
  }

  @objc public func use_background_audio(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(UseBackgroundAudioRequestArgs.self)
      let enabled = args.enabled
      let session = AVAudioSession.sharedInstance()
      if enabled {
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
        logger.log("AVAudioSession activated")
      } else {
        try session.setActive(false)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        logger.log("AVAudioSession deactivated")
      }
      invoke.resolve()
    } catch {
      logger.error("Failed to set up audio session: \(error)")
    }
  }

  @objc public func auth_with_safari(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SafariAuthRequestArgs.self)
    let authUrl = URL(string: args.authUrl)!

    authSession = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: "readest") {
      [weak self] callbackURL, error in
      guard let strongSelf = self else { return }

      if let error = error {
        logger.error("Auth session error: \(error.localizedDescription)")
        invoke.reject(error.localizedDescription)
        return
      }

      if let callbackURL = callbackURL {
        strongSelf.authSession?.cancel()
        strongSelf.authSession = nil
        invoke.resolve(["redirectUrl": callbackURL.absoluteString])
      }
    }

    if #available(iOS 13.0, *) {
      authSession?.presentationContextProvider = self
    }

    let started = authSession?.start() ?? false
    logger.log("Auth session start result: \(started)")
  }

  @objc public func set_system_ui_visibility(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetSystemUIVisibilityRequestArgs.self)
    let visible = args.visible
    let darkMode = args.darkMode

    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = !visible
      UIApplication.shared.setStatusBarHidden(!visible, with: .none)

      let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }

      let keyWindow = windows.first(where: { $0.isKeyWindow }) ?? windows.first
      if let keyWindow = keyWindow {
        keyWindow.overrideUserInterfaceStyle = darkMode ? .dark : .light
        keyWindow.layoutIfNeeded()
      } else {
        logger.error("No key window found")
      }
    }
    invoke.resolve(["success": true])
  }

  @objc public func get_sys_fonts_list(_ invoke: Invoke) throws {
    var fontDict: [String: String] = [:]

    for family in UIFont.familyNames.sorted() {
      if let localized = getLocalizedDisplayName(familyName: family) {
        fontDict[family] = localized
      } else {
        let fontNames = UIFont.fontNames(forFamilyName: family)
        if fontNames.isEmpty {
          fontDict[family] = family
        } else {
          for fontName in fontNames {
            fontDict[fontName] = family
          }
        }
      }
    }

    invoke.resolve(["fonts": fontDict])
  }

  @objc public func intercept_keys(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(InterceptKeysRequestArgs.self)

      if let volumeKeys = args.volumeKeys {
        if volumeKeys {
          self.activateVolumeKeyInterception()
        } else {
          self.volumeKeyHandler?.stopInterception()
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.volumeKeyHandler = nil
          }
        }
      }
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func lock_screen_orientation(_ invoke: Invoke) throws {
    guard let args = try? invoke.parseArgs(LockScreenOrientationRequestArgs.self) else {
      return invoke.reject("Invalid arguments")
    }

    DispatchQueue.main.async {
      UIDevice.current.beginGeneratingDeviceOrientationNotifications()
      let orientation = args.orientation ?? "auto"
      switch orientation.lowercased() {
      case "portrait":
        self.changeOrientation(.portrait)
      case "landscape":
        self.changeOrientation(.landscape)
      case "auto":
        self.changeOrientation(.all)
      default:
        invoke.reject("Invalid orientation mode")
        return
      }

      invoke.resolve()
    }
  }

  private func changeOrientation(_ orientationMask: UIInterfaceOrientationMask) {
    self.currentOrientationMask = orientationMask
    if #available(iOS 16.0, *) {
      if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
        for window in windowScene.windows {
          if let rootVC = window.rootViewController {
            rootVC.setNeedsUpdateOfSupportedInterfaceOrientations()
          }
        }
        if orientationMask == .all {
          windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: .all)) { error in
            logger.error("Orientation update error: \(error.localizedDescription)")
            DispatchQueue.main.async {
              UIViewController.attemptRotationToDeviceOrientation()
            }
          }
        } else {
          windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: orientationMask)) { error in
            logger.error("Orientation update error: \(error.localizedDescription)")
          }
        }
      }
    } else {
      if orientationMask == .all {
        UIViewController.attemptRotationToDeviceOrientation()
      } else {
        let specificOrientation: UIInterfaceOrientation
        if orientationMask.contains(.portrait) {
          specificOrientation = .portrait
        } else if orientationMask.contains(.landscape) {
          let currentOrientation = UIDevice.current.orientation
          if currentOrientation == .landscapeLeft {
            specificOrientation = .landscapeRight
          } else if currentOrientation == .landscapeRight {
            specificOrientation = .landscapeLeft
          } else {
            specificOrientation = .landscapeRight
          }
        } else {
          specificOrientation = .portrait
        }
        UIDevice.current.setValue(specificOrientation.rawValue, forKey: "orientation")
        UIViewController.attemptRotationToDeviceOrientation()
      }
    }
  }

  @objc public func iap_initialize(_ invoke: Invoke) {
    StoreKitManager.shared.initialize()
    invoke.resolve(["success": true])
  }

  @objc public func iap_fetch_products(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(FetchProductsRequest.self)

      StoreKitManager.shared.fetchProducts(productIds: args.productIds) { products in
        let productsData: [ProductData] = products.map { product in
          return ProductData(
            id: product.productIdentifier,
            title: product.localizedTitle,
            description: product.localizedDescription,
            price: product.price.stringValue,
            priceCurrencyCode: product.priceLocale.currencyCode,
            priceAmountMicros: Int64(product.price.doubleValue * 1_000_000),
            productType: product.productIdentifier.contains("monthly")
              || product.productIdentifier.contains("yearly") ? "subscription" : "consumable"
          )
        }
        invoke.resolve(["products": productsData])
      }
    } catch {
      invoke.reject("Failed to parse fetch products arguments: \(error.localizedDescription)")
    }
  }

  @objc public func iap_purchase_product(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PurchaseProductRequest.self)

      StoreKitManager.shared.fetchProducts(productIds: [args.productId]) { products in
        guard let product = products.first else {
          invoke.reject("Product not found")
          return
        }

        StoreKitManager.shared.purchase(product: product) { result in
          switch result {
          case .success(let txn):
            let purchase = PurchaseData(
              productId: txn.payment.productIdentifier,
              transactionId: txn.transactionIdentifier ?? "",
              originalTransactionId: txn.original?.transactionIdentifier ?? txn
                .transactionIdentifier ?? "",
              purchaseDate: ISO8601DateFormatter().string(from: txn.transactionDate ?? Date()),
              purchaseState: "purchased",
              platform: "ios"
            )
            invoke.resolve(["purchase": purchase])
          case .failure(let error):
            invoke.reject("Purchase failed: \(error.localizedDescription)")
          }
        }
      }
    } catch {
      invoke.reject("Failed to parse purchase arguments: \(error.localizedDescription)")
    }
  }

  @objc public func iap_restore_purchases(_ invoke: Invoke) {
    StoreKitManager.shared.restorePurchases { transactions in
      let restored = transactions.map { txn -> PurchaseData in
        return PurchaseData(
          productId: txn.payment.productIdentifier,
          transactionId: txn.transactionIdentifier ?? "",
          originalTransactionId: txn.original?.transactionIdentifier ?? txn.transactionIdentifier
            ?? "",
          purchaseDate: ISO8601DateFormatter().string(from: txn.transactionDate ?? Date()),
          purchaseState: "restored",
          platform: "ios"
        )
      }
      invoke.resolve(["purchases": restored])
    }
  }

  @objc public func get_system_color_scheme(_ invoke: Invoke) {
    let userInterfaceStyle = UITraitCollection.current.userInterfaceStyle
    let colorScheme = (userInterfaceStyle == .dark) ? "dark" : "light"
    invoke.resolve(["colorScheme": colorScheme])
  }
}

@_cdecl("init_plugin_native_bridge")
func initPlugin() -> Plugin {
  return NativeBridgePlugin()
}

@available(iOS 13.0, *)
extension NativeBridgePlugin: ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return UIApplication.shared.windows.first ?? UIWindow()
  }
}

extension NativeBridgePlugin: UIApplicationDelegate {
  public func application(
    _ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?
  ) -> UIInterfaceOrientationMask {
    return self.currentOrientationMask
  }

  /*
    Proxy all application delegate methods to the original delegate:
      sel!(application:didFinishLaunchingWithOptions:),
      sel!(application:openURL:options:),
      sel!(application:continue:restorationHandler:),
      sel!(applicationDidBecomeActive:),
      sel!(applicationWillResignActive:),
      sel!(applicationWillEnterForeground:),
      sel!(applicationDidEnterBackground:),
      sel!(applicationWillTerminate:),
  */

  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    self.originalDelegate?.application?(application, didFinishLaunchingWithOptions: launchOptions)
      ?? false
  }

  public func application(
    _ application: UIApplication, open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    self.originalDelegate?.application?(application, open: url, options: options) ?? false
  }

  public func application(
    _ application: UIApplication, continue continueUserActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    self.originalDelegate?.application?(
      application, continue: continueUserActivity, restorationHandler: restorationHandler) ?? false
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    self.originalDelegate?.applicationDidBecomeActive?(application)
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    self.originalDelegate?.applicationWillResignActive?(application)
  }

  public func applicationWillEnterForeground(_ application: UIApplication) {
    self.originalDelegate?.applicationWillEnterForeground?(application)
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    self.originalDelegate?.applicationDidEnterBackground?(application)
  }

  public func applicationWillTerminate(_ application: UIApplication) {
    self.originalDelegate?.applicationWillTerminate?(application)
  }
}
