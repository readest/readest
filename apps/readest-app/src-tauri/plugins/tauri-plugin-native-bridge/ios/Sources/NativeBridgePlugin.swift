import AVFoundation
import AuthenticationServices
import CoreText
import MediaPlayer
import ObjectiveC
import StoreKit
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
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
  // ASWebAuthenticationSession callback scheme. Defaults to "readest" (the
  // Supabase login); the Google Drive flow passes its reverse-DNS scheme so the
  // session intercepts that redirect instead.
  let callbackScheme: String?
}

class UseBackgroundAudioRequestArgs: Decodable {
  let enabled: Bool
}

class SetTextSelectionSuppressedRequestArgs: Decodable {
  let suppressed: Bool
}

class SetSystemUIVisibilityRequestArgs: Decodable {
  let visible: Bool
  let darkMode: Bool
}

class InterceptKeysRequestArgs: Decodable {
  let backKey: Bool?
  let volumeKeys: Bool?
  let pageTurnerKeys: Bool?
  let learnMode: Bool?
}

class LockScreenOrientationRequestArgs: Decodable {
  let orientation: String?
}

class SetScreenBrightnessRequestArgs: Decodable {
  let brightness: Float?
}

class CopyUriToPathRequestArgs: Decodable {
  let uri: String?
  let dst: String?
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
  private var ttsOwnsAudioSession = false
  private var ttsSessionObservers: [NSObjectProtocol] = []

  override init() {
    super.init()
    // tauri-plugin-native-tts announces claim/release of the shared audio
    // session (see claimAudioSession/deactivateRemoteCommands there). While
    // TTS owns it (playing or paused), interception must not reconfigure the
    // session: flipping the non-mixable .playback claim to .mixWithOthers
    // makes the app ineligible for the Now Playing slot (lock-screen card
    // dismissed, AirPod controls fall through to another app). Volume KVO
    // works on the TTS-held session as-is.
    let center = NotificationCenter.default
    ttsSessionObservers.append(
      center.addObserver(
        forName: Notification.Name("ReadestTTSAudioSessionClaimed"), object: nil, queue: .main
      ) { [weak self] _ in
        self?.ttsOwnsAudioSession = true
      })
    ttsSessionObservers.append(
      center.addObserver(
        forName: Notification.Name("ReadestTTSAudioSessionReleased"), object: nil, queue: .main
      ) { [weak self] _ in
        guard let self = self else { return }
        self.ttsOwnsAudioSession = false
        // TTS teardown deactivated the session, and it is unordered relative
        // to a (re)start of interception. If interception is live, re-own the
        // session so volume KVO keeps firing.
        if self.isIntercepting {
          self.configureAudioSession()
        }
      })
  }

  deinit {
    for observer in ttsSessionObservers {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  private func configureAudioSession() {
    // TTS holds an active non-mixable session; leave it untouched (see init).
    if ttsOwnsAudioSession { return }
    do {
      try audioSession?.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try audioSession?.setActive(true)
    } catch {
      logger.error("Failed to activate audio session: \(error)")
    }
  }

  func startInterception(webView: WKWebView) {
    if isIntercepting {
      stopInterception()
    }

    logger.log("Starting volume key interception")
    self.webView = webView
    isIntercepting = true

    audioSession = AVAudioSession.sharedInstance()
    configureAudioSession()

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

class MediaKeyHandler {
  private weak var webView: WKWebView?
  private var registered = false
  private let commandCenter = MPRemoteCommandCenter.shared()

  func start(webView: WKWebView) {
    self.webView = webView
    if registered { return }
    registered = true
    commandCenter.nextTrackCommand.isEnabled = true
    commandCenter.previousTrackCommand.isEnabled = true
    commandCenter.nextTrackCommand.addTarget { [weak self] _ in
      self?.forward("MediaNext")
      return .success
    }
    commandCenter.previousTrackCommand.addTarget { [weak self] _ in
      self?.forward("MediaPrevious")
      return .success
    }
    logger.log("MediaKeyHandler: started")
  }

  func stop() {
    if !registered { return }
    registered = false
    commandCenter.nextTrackCommand.removeTarget(nil)
    commandCenter.previousTrackCommand.removeTarget(nil)
    logger.log("MediaKeyHandler: stopped")
  }

  private func forward(_ name: String) {
    DispatchQueue.main.async { [weak self] in
      self?.webView?.evaluateJavaScript(
        "try { window.onNativeKeyDown('\(name)', 0); } catch (_) {}", completionHandler: nil)
    }
  }
}

class WebViewLifecycleManager: NSObject {
  private weak var webView: WKWebView?
  private var originalNavigationDelegate: WKNavigationDelegate?
  private var isMonitoring = false
  private var lastBackgroundTime: Date?
  private var backgroundTimeThreshold: TimeInterval = 180.0

  func startMonitoring(webView: WKWebView) {
    self.webView = webView
    originalNavigationDelegate = webView.navigationDelegate
    webView.navigationDelegate = self
    isMonitoring = true
    logger.log("WebViewLifecycleManager: Started monitoring WebView")
  }

  func stopMonitoring() {
    isMonitoring = false
    if let original = originalNavigationDelegate {
      webView?.navigationDelegate = original
    }

    logger.log("WebViewLifecycleManager: Stopped monitoring WebView")
  }

  func handleAppWillEnterForeground() {
    guard isMonitoring, let webView = webView else {
      logger.warning(
        "WebViewLifecycleManager: Cannot handle foreground - not monitoring or webView is nil")
      return
    }

    logger.log("WebViewLifecycleManager: App entering foreground")

    var timeInBackground: TimeInterval = 0
    if let backgroundTime = lastBackgroundTime {
      timeInBackground = Date().timeIntervalSince(backgroundTime)
      logger.log("WebViewLifecycleManager: Time in background: \(timeInBackground)s")
    }

    // If app was backgrounded for more than threshold, check WebView health
    if timeInBackground > backgroundTimeThreshold {
      logger.log(
        "WebViewLifecycleManager: App was backgrounded for \(timeInBackground)s, checking WebView health..."
      )
      checkAndRecoverWebView(webView, reason: "long_background")
    } else {
      // Still do a quick check after a small delay
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
        self?.quickHealthCheck(webView)
      }
    }

    lastBackgroundTime = nil
  }

  func handleAppWillResignActive() {
    logger.log("WebViewLifecycleManager: App will resign active")
    guard let webView = webView else { return }
    webView.evaluateJavaScript("window.location.href") { result, error in
      if let error = error {
        logger.error("WebViewLifecycleManager: Failed to capture URL on background: \(error)")
        return
      }

      if let urlString = result as? String {
        if urlString.hasPrefix("http") || urlString.hasPrefix("tauri") {
          UserDefaults.standard.set(urlString, forKey: "tauri_last_valid_url")
          logger.log("WebViewLifecycleManager: Saved valid URL")
        }
      }
    }
  }

  func handleAppDidEnterBackground() {
    lastBackgroundTime = Date()
  }

  private func quickHealthCheck(_ webView: WKWebView) {
    logger.log("WebViewLifecycleManager: Performing quick health check")

    webView.evaluateJavaScript("window.location.href") { [weak self] result, error in
      if let error = error {
        logger.error("WebViewLifecycleManager: Quick health check failed: \(error)")
        self?.checkAndRecoverWebView(webView, reason: "health_check_failed")
      } else if let urlString = result as? String {
        if urlString.contains("about:blank") || urlString.isEmpty {
          logger.warning("WebViewLifecycleManager: WebView showing about:blank!")
          self?.recoverWebView(webView, reason: "about_blank")
        }
      }
    }
  }

  private func checkAndRecoverWebView(_ webView: WKWebView, reason: String) {
    logger.log("WebViewLifecycleManager: Checking WebView health (reason: \(reason))")

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      webView.evaluateJavaScript("window.location.href") { result, error in
        if let error = error {
          logger.error("WebViewLifecycleManager: Error checking WebView URL: \(error)")
          self?.recoverWebView(webView, reason: "js_error_\(reason)")
        } else if let urlString = result as? String {
          logger.log("WebViewLifecycleManager: Current URL after \(reason): \(urlString)")
          if urlString.contains("about:blank") || urlString.isEmpty {
            logger.warning("WebViewLifecycleManager: Detected blank WebView after \(reason)")
            self?.recoverWebView(webView, reason: reason)
          } else {
            logger.log("WebViewLifecycleManager: WebView appears healthy")
          }
        }
      }
    }
  }

  private func recoverWebView(_ webView: WKWebView, reason: String) {
    logger.log("WebViewLifecycleManager: Recovering WebView (reason: \(reason))")

    if let lastURL = UserDefaults.standard.string(forKey: "tauri_last_valid_url"),
      let url = URL(string: lastURL)
    {
      logger.log("WebViewLifecycleManager: Reloading from saved URL: \(lastURL)")
      webView.load(URLRequest(url: url))
    } else {
      logger.log("WebViewLifecycleManager: No saved URL, performing standard reload")
      webView.reload()
    }
  }
}

extension WebViewLifecycleManager: WKNavigationDelegate {

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    logger.error("WebViewLifecycleManager: WebContent process TERMINATED!️")
    recoverWebView(webView, reason: "process_terminated")

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webViewWebContentProcessDidTerminate(_:)))
    {
      original.webViewWebContentProcessDidTerminate?(webView)
    }
  }

  // Save successful navigation URLs
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if let url = webView.url {
      let urlString = url.absoluteString

      if urlString.hasPrefix("http") || urlString.hasPrefix("tauri") {
        UserDefaults.standard.set(urlString, forKey: "tauri_last_valid_url")
        logger.log("WebViewLifecycleManager: Saved valid URL")
      }
    }

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didFinish:)))
    {
      original.webView?(webView, didFinish: navigation)
    }
  }

  // Proxy other important navigation delegate methods
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    logger.error("WebViewLifecycleManager: Navigation failed: \(error)")

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didFail:withError:)))
    {
      original.webView?(webView, didFail: navigation, withError: error)
    }
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    logger.error("WebViewLifecycleManager: Provisional navigation failed: \(error)")

    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didFailProvisionalNavigation:withError:)))
    {
      original.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didStartProvisionalNavigation:)))
    {
      original.webView?(webView, didStartProvisionalNavigation: navigation)
    }
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    if let original = originalNavigationDelegate,
      original.responds(to: #selector(webView(_:didCommit:)))
    {
      original.webView?(webView, didCommit: navigation)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if let original = originalNavigationDelegate {
      original.webView?(
        webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler)
    } else {
      decisionHandler(.allow)
    }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if let original = originalNavigationDelegate {
      original.webView?(
        webView, decidePolicyFor: navigationResponse, decisionHandler: decisionHandler)
    } else {
      decisionHandler(.allow)
    }
  }
}

class NativeBridgePlugin: Plugin {
  private var webView: WKWebView?
  private var authSession: ASWebAuthenticationSession?
  private var currentOrientationMask: UIInterfaceOrientationMask = .all
  private var originalDelegate: UIApplicationDelegate?
  private var webViewLifecycleManager: WebViewLifecycleManager?
  private var traitChangeRegistered = false

  // Screen-brightness management. `UIScreen.main.brightness` is a *global*
  // device setting, not a per-window one: once the app writes to it, iOS
  // suppresses ambient auto-brightness and the override survives backgrounding,
  // leaving the system stuck at the app's level until the user nudges it
  // manually (issue #4885). We remember the value that was there before the
  // first override so we can hand it back whenever the app leaves the
  // foreground, and re-assert the app's value when it returns.
  private var appDesiredBrightness: CGFloat?
  private var systemBrightnessBeforeOverride: CGFloat?

  @objc public override func load(webview: WKWebView) {
    self.webView = webview
    logger.log("NativeBridgePlugin loaded")

    // Suppress the iOS system text-selection edit menu so it never
    // covers Readest's annotation toolbar. See ContextMenuSuppressor.
    ContextMenuSuppressor.installIfNeeded()

    // Register a WKScriptMessageHandler so JS can signal when its
    // share-extension hook has mounted. On `{type: 'ready'}` we run a
    // sync immediately, which is the cold-start path (app launched
    // because the Share Extension just woke it up, JS may not have been
    // listening when the first `appDidBecomeActive` fired).
    webview.configuration.userContentController.add(
      ShareBridgeMessageHandler(owner: self), name: "readestShareBridge")

    webViewLifecycleManager = WebViewLifecycleManager()
    webViewLifecycleManager?.startMonitoring(webView: webview)
    logger.log("NativeBridgePlugin: WebView lifecycle monitoring activated")

    // The WKWebView never fires the `prefers-color-scheme` media query
    // `change` event while the app stays foregrounded, so observe the
    // native appearance and push changes to JS instead. Registration is
    // deferred because the window scene may not be connected yet.
    DispatchQueue.main.async { [weak self] in
      self?.registerTraitChangeObserverIfNeeded()
    }

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

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(appWillEnterForeground),
      name: UIApplication.willEnterForegroundNotification,
      object: nil
    )

    if let app = UIApplication.value(forKey: "sharedApplication") as? UIApplication {
      self.originalDelegate = app.delegate
      app.delegate = self
    } else {
      Logger.error("NativeBridgePlugin: Failed to get shared application")
    }

    // Re-acquire security-scoped access for every external library
    // folder the user registered in a previous session. Done here in
    // `load` so the WebView can issue fs reads against those paths as
    // soon as the JS layer comes up. See `FolderBookmarkStore`
    // for the why and how.
    FolderBookmarkStore.restoreAllPersisted()
  }

  @objc func appWillEnterForeground() {
    logger.log("NativeBridgePlugin: App will enter foreground")
    // Re-assert the app's brightness that was released on background (#4885).
    if let desired = appDesiredBrightness {
      UIScreen.main.brightness = desired
    }
    webViewLifecycleManager?.handleAppWillEnterForeground()
  }

  @objc func appDidBecomeActive() {
    if volumeKeyHandler != nil {
      activateVolumeKeyInterception()
    }
    registerTraitChangeObserverIfNeeded()
    // Fallback for iOS < 17 (no `registerForTraitChanges`): re-check the
    // appearance whenever the app becomes active, e.g. after toggling
    // dark mode from Control Center.
    notifyColorSchemeChange()
    syncShareExtensionState()
  }

  /// JS-initiated entry point. The share-extension JS hook calls
  /// `window.webkit.messageHandlers.readestShareBridge.postMessage({type:'ready'})`
  /// once mounted, which routes here so the cold-start drain happens
  /// even when the JS hook wasn't listening at app launch.
  @objc func syncShareExtensionStateFromJS() {
    syncShareExtensionState()
  }

  /// Bridge between the Readest Share Extension (separate process) and
  /// the host app's JS, via the App Group container at
  /// `group.com.bilingify.readest`. Two directions on every activation:
  ///
  ///   1. Groups (host → extension). Read the current library group list
  ///      from JS (`window.__readestGetGroups`) and persist it so the
  ///      extension's picker shows up-to-date options next time the user
  ///      shares. If the JS function isn't installed yet (cold start, hook
  ///      hasn't mounted), no-op — the next activation will refresh.
  ///
  ///   2. Pending saves (extension → host). Drain any queued saves the
  ///      extension wrote, hand them to JS
  ///      (`window.__readestOnShareExtensionPending`), then clear the
  ///      queue only if JS confirmed receipt. If JS isn't ready yet,
  ///      leave the queue intact — the next activation (or the JS hook
  ///      on its own mount) will pick them up.
  private func syncShareExtensionState() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let webView = self.webView else { return }
      // Pull groups + the user-locale "Default" label from JS → App Group.
      webView.evaluateJavaScript(
        "(window.__readestGetGroups && window.__readestGetGroups()) || null"
      ) { result, _ in
        guard let payload = result as? [String: Any] else { return }
        if let array = payload["groups"] as? [[String: Any]] {
          let groups: [AppGroupBridge.LibraryGroup] = array.compactMap { item in
            guard let id = item["id"] as? String, let name = item["name"] as? String else {
              return nil
            }
            return AppGroupBridge.LibraryGroup(id: id, name: name)
          }
          AppGroupBridge.writeGroups(groups)
        }
        if let defaultName = payload["defaultGroupName"] as? String, !defaultName.isEmpty {
          AppGroupBridge.writeDefaultGroupName(defaultName)
        }
      }
      // Push pending saves → JS, clear queue iff JS confirmed.
      let saves = AppGroupBridge.readPendingSaves()
      guard !saves.isEmpty else { return }
      let payload: [[String: Any?]] = saves.map { save in
        [
          "url": save.url,
          "groupId": save.groupId,
          "groupName": save.groupName,
          "addedAt": save.addedAt,
        ]
      }
      guard let json = try? JSONSerialization.data(withJSONObject: payload, options: []),
        let jsonString = String(data: json, encoding: .utf8)
      else { return }
      let script =
        "(window.__readestOnShareExtensionPending && window.__readestOnShareExtensionPending(\(jsonString))) === true"
      webView.evaluateJavaScript(script) { result, _ in
        if let acknowledged = result as? Bool, acknowledged {
          AppGroupBridge.clearPendingSaves()
        }
      }
    }
  }

  // Resolves the foreground window scene. Its trait collection reflects
  // the real system appearance and is unaffected by the per-window
  // `overrideUserInterfaceStyle` that `set_system_ui_visibility` applies.
  private func foregroundWindowScene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }

  private func systemColorScheme() -> String {
    let userInterfaceStyle =
      foregroundWindowScene()?.traitCollection.userInterfaceStyle
      ?? UITraitCollection.current.userInterfaceStyle
    return (userInterfaceStyle == .dark) ? "dark" : "light"
  }

  private func registerTraitChangeObserverIfNeeded() {
    guard !traitChangeRegistered, #available(iOS 17.0, *) else { return }
    guard let windowScene = foregroundWindowScene() else { return }
    traitChangeRegistered = true
    MainActor.assumeIsolated {
      windowScene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) {
        [weak self] (_: UIWindowScene, _: UITraitCollection) in
        self?.notifyColorSchemeChange()
      }
    }
  }

  private func notifyColorSchemeChange() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let webView = self.webView else { return }
      let colorScheme = self.systemColorScheme()
      webView.evaluateJavaScript(
        "try { window.onNativeColorSchemeChange && window.onNativeColorSchemeChange('\(colorScheme)'); } catch (_) {}",
        completionHandler: nil)
    }
  }

  @objc func appDidEnterBackground() {
    logger.log("NativeBridgePlugin: App did enter background")
    if let handler = volumeKeyHandler, handler.isIntercepting {
      handler.stopInterception()
    }
    // Hand screen brightness back to iOS so ambient auto-brightness resumes
    // while backgrounded; the override is re-applied on foreground (#4885).
    if appDesiredBrightness != nil, let original = systemBrightnessBeforeOverride {
      UIScreen.main.brightness = original
    }
    webViewLifecycleManager?.handleAppDidEnterBackground()
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
    webViewLifecycleManager?.stopMonitoring()
    webViewLifecycleManager = nil

    NotificationCenter.default.removeObserver(self)
  }

  private struct AssociatedKeys {
    static var volumeKeyHandler = "volumeKeyHandler"
    static var interceptingVolumeKeys = "interceptingVolumeKeys"
    static var mediaKeyHandler = "mediaKeyHandler"
    static var mediaKeyState = "mediaKeyState"
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

  private var mediaKeyHandler: MediaKeyHandler? {
    get {
      return objc_getAssociatedObject(self, &AssociatedKeys.mediaKeyHandler) as? MediaKeyHandler
    }
    set {
      objc_setAssociatedObject(
        self, &AssociatedKeys.mediaKeyHandler, newValue, .OBJC_ASSOCIATION_RETAIN)
    }
  }

  // Bit 0 = pageTurnerKeys interception, bit 1 = learn mode.
  private var mediaKeyState: Int {
    get {
      return objc_getAssociatedObject(self, &AssociatedKeys.mediaKeyState) as? Int ?? 0
    }
    set {
      objc_setAssociatedObject(
        self, &AssociatedKeys.mediaKeyState, newValue, .OBJC_ASSOCIATION_RETAIN)
    }
  }

  private func updateMediaKeyHandler() {
    let shouldRun = mediaKeyState != 0
    if shouldRun {
      if mediaKeyHandler == nil {
        mediaKeyHandler = MediaKeyHandler()
      }
      if let webView = self.webView {
        mediaKeyHandler?.start(webView: webView)
      } else {
        logger.warning("Cannot start media key handler: webView is nil")
      }
    } else {
      mediaKeyHandler?.stop()
      mediaKeyHandler = nil
    }
  }

  // OBSOLETE for TTS (no JS callers since 2026-07): the native-tts plugin now
  // claims the audio session itself (non-mixable .playback/.spokenAudio) when
  // its media session activates. The .mixWithOthers set here disqualifies the
  // app from Now Playing — do not reintroduce calls around TTS playback.
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

  // Instant-highlight mode owns the touch long-press: suppress the system
  // text selection for non-editable content so it can never race the app's
  // hold-to-highlight gesture. See TextSelectionSuppressor.
  @objc public func set_text_selection_suppressed(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetTextSelectionSuppressedRequestArgs.self)
    DispatchQueue.main.async {
      TextSelectionSuppressor.setSuppressed(args.suppressed)
    }
    invoke.resolve()
  }

  @objc public func auth_with_safari(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SafariAuthRequestArgs.self)
    let authUrl = URL(string: args.authUrl)!
    let callbackScheme = args.callbackScheme ?? "readest"

    authSession = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: callbackScheme) {
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
          // Stop intercepting but KEEP the handler alive — do NOT nil it. Its
          // ReadestTTSAudioSessionClaimed/Released observers must survive the
          // play/pause cycle. usePagination releases interception the instant TTS
          // starts playing (the `ttsPlaying` gate) — which is exactly when
          // tauri-plugin-native-tts posts "Claimed" — and re-acquires it on
          // pause. If the handler is destroyed here, that fire-once "Claimed" is
          // lost, and the fresh handler built on the next pause has
          // ttsOwnsAudioSession=false, so it reconfigures the TTS-owned session
          // to .mixWithOthers. A mixable session is ineligible for Now Playing,
          // so iOS vacates the slot and AirPods / lock-screen play resumes
          // whatever app played before us. A single long-lived handler catches
          // the claim and leaves the TTS session untouched.
          self.volumeKeyHandler?.stopInterception()
        }
      }

      if let pageTurnerKeys = args.pageTurnerKeys {
        mediaKeyState = pageTurnerKeys ? (mediaKeyState | 1) : (mediaKeyState & ~1)
      }
      if let learnMode = args.learnMode {
        mediaKeyState = learnMode ? (mediaKeyState | 2) : (mediaKeyState & ~2)
      }
      if args.pageTurnerKeys != nil || args.learnMode != nil {
        DispatchQueue.main.async { [weak self] in
          self?.updateMediaKeyHandler()
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

  @objc public func iap_is_available(_ invoke: Invoke) {
    invoke.resolve(["available": true])
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
    DispatchQueue.main.async { [weak self] in
      invoke.resolve(["colorScheme": self?.systemColorScheme() ?? "light"])
    }
  }

  @objc public func get_screen_brightness(_ invoke: Invoke) {
    let brightness = UIScreen.main.brightness
    invoke.resolve(["brightness": brightness])
  }

  @objc public func set_screen_brightness(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(SetScreenBrightnessRequestArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }

    let brightness = args.brightness ?? 0.5

    if brightness > 1.0 {
      return invoke.reject("Brightness must be between 0.0 and 1.0")
    }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if brightness < 0.0 {
        // A negative value means "release control back to the system", mirroring
        // Android's BRIGHTNESS_OVERRIDE_NONE. Restore the pre-override brightness
        // so iOS resumes ambient auto-brightness.
        self.releaseBrightnessControl()
      } else {
        if self.systemBrightnessBeforeOverride == nil {
          self.systemBrightnessBeforeOverride = UIScreen.main.brightness
        }
        self.appDesiredBrightness = CGFloat(brightness)
        UIScreen.main.brightness = CGFloat(brightness)
      }
    }
    invoke.resolve(["success": true])
  }

  /// Restore the brightness captured before the app first overrode it so iOS
  /// resumes ambient auto-brightness, then forget our managed state. Must run
  /// on the main thread.
  private func releaseBrightnessControl() {
    if let original = systemBrightnessBeforeOverride {
      UIScreen.main.brightness = original
    }
    appDesiredBrightness = nil
    systemBrightnessBeforeOverride = nil
  }

  @objc public func copy_uri_to_path(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(CopyUriToPathRequestArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }

    guard let uriString = args.uri, let dstPath = args.dst else {
      return invoke.reject("URI and destination path must be provided")
    }

    let uri: URL
    if uriString.hasPrefix("file://") {
      let path = String(uriString.dropFirst("file://".count))
      guard let decodedPath = path.removingPercentEncoding else {
        return invoke.reject("Invalid URI encoding")
      }
      uri = URL(fileURLWithPath: decodedPath)
    } else {
      guard let parsed = URL(string: uriString) else {
        return invoke.reject("Invalid URI")
      }
      uri = parsed
    }

    let fileManager = FileManager.default
    let dstURL = URL(fileURLWithPath: dstPath)

    do {
      let didStartAccessing = uri.startAccessingSecurityScopedResource()
      defer {
        if didStartAccessing {
          uri.stopAccessingSecurityScopedResource()
        }
      }

      var shouldCopy = false

      if fileManager.fileExists(atPath: dstURL.path) {
        let srcAttributes = try fileManager.attributesOfItem(atPath: uri.path)
        let dstAttributes = try fileManager.attributesOfItem(atPath: dstURL.path)

        let srcModDate = srcAttributes[.modificationDate] as? Date ?? Date.distantPast
        let dstModDate = dstAttributes[.modificationDate] as? Date ?? Date.distantPast

        if srcModDate > dstModDate {
          try fileManager.removeItem(at: dstURL)
          shouldCopy = true
        } else {
          shouldCopy = false
        }
      } else {
        shouldCopy = true
      }

      if shouldCopy {
        try fileManager.copyItem(at: uri, to: dstURL)
      }

      invoke.resolve(["success": true])
    } catch {
      invoke.reject("Failed to copy file: \(error.localizedDescription)")
    }
  }

  @objc public func get_storefront_region_code(_ invoke: Invoke) {
    Task {
      if let storefront = await Storefront.current {
        invoke.resolve(["regionCode": storefront.countryCode])
      } else {
        invoke.reject("Failed to get region code")
      }
    }
  }

  @objc public func get_safe_area_insets(_ invoke: Invoke) {
    DispatchQueue.main.async {
      if let window = UIApplication.shared.windows.first {
        let insets = window.safeAreaInsets
        invoke.resolve([
          "top": insets.top,
          "left": insets.left,
          "bottom": insets.bottom,
          "right": insets.right
        ])
      } else {
        invoke.resolve([
          "error": "No window found",
          "top": 0,
          "left": 0,
          "bottom": 0,
          "right": 0
        ])
      }
    }
  }

  // ── Sync passphrase keychain ──────────────────────────────────────────
  // Backed by the iOS Security framework Keychain. The TS-side
  // CryptoSession reads/writes via these commands so the user's sync
  // passphrase persists across app launches.

  private static let syncKeychainService = "com.bilingify.readest.sync-passphrase"
  private static let syncKeychainAccount = "default"

  private func syncKeychainBaseQuery() -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: NativeBridgePlugin.syncKeychainService,
      kSecAttrAccount as String: NativeBridgePlugin.syncKeychainAccount
    ]
  }

  @objc public func set_sync_passphrase(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SyncPassphraseSetArgs.self)
      guard let data = args.passphrase.data(using: .utf8) else {
        invoke.resolve(["success": false, "error": "encoding"])
        return
      }
      var query = syncKeychainBaseQuery()
      query[kSecValueData as String] = data
      // Replace any existing entry. Delete-then-add keeps the
      // accessibility class consistent across SDK versions.
      SecItemDelete(query as CFDictionary)
      let status = SecItemAdd(query as CFDictionary, nil)
      if status == errSecSuccess {
        invoke.resolve(["success": true])
      } else {
        invoke.resolve(["success": false, "error": "OSStatus \(status)"])
      }
    } catch {
      invoke.resolve(["success": false, "error": "\(error)"])
    }
  }

  @objc public func get_sync_passphrase(_ invoke: Invoke) {
    var query = syncKeychainBaseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data, let s = String(data: data, encoding: .utf8) {
      invoke.resolve(["passphrase": s])
    } else if status == errSecItemNotFound {
      // No entry: empty response. The TS layer treats this as "prompt".
      invoke.resolve([:])
    } else {
      invoke.resolve(["error": "OSStatus \(status)"])
    }
  }

  @objc public func clear_sync_passphrase(_ invoke: Invoke) {
    let status = SecItemDelete(syncKeychainBaseQuery() as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound {
      invoke.resolve(["success": true])
    } else {
      invoke.resolve(["success": false, "error": "OSStatus \(status)"])
    }
  }

  @objc public func is_sync_keychain_available(_ invoke: Invoke) {
    // The Keychain is always available on iOS; report true and let the
    // TS layer trust it. We probe SecItemCopyMatching anyway so a
    // future sandbox restriction surfaces an explicit error.
    var query = syncKeychainBaseQuery()
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    if status == errSecSuccess || status == errSecItemNotFound {
      invoke.resolve(["available": true])
    } else {
      invoke.resolve(["available": false, "error": "OSStatus \(status)"])
    }
  }

  // ── Keyed secure key-value store ──────────────────────────────────
  // Same Keychain backing as the sync passphrase, but a generic keyed
  // store: one service, the caller's `key` as the account, so secrets
  // like the Google Drive token set persist the same way.

  private static let secureItemsService = "com.bilingify.readest.secure-items"

  private func secureItemBaseQuery(_ key: String) -> [String: Any] {
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: NativeBridgePlugin.secureItemsService,
      kSecAttrAccount as String: key
    ]
  }

  @objc public func set_secure_item(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SecureItemSetArgs.self)
      guard let data = args.value.data(using: .utf8) else {
        invoke.resolve(["success": false, "error": "encoding"])
        return
      }
      var query = secureItemBaseQuery(args.key)
      query[kSecValueData as String] = data
      // Replace any existing entry. Delete-then-add keeps the
      // accessibility class consistent across SDK versions.
      SecItemDelete(query as CFDictionary)
      let status = SecItemAdd(query as CFDictionary, nil)
      if status == errSecSuccess {
        invoke.resolve(["success": true])
      } else {
        invoke.resolve(["success": false, "error": "OSStatus \(status)"])
      }
    } catch {
      invoke.resolve(["success": false, "error": "\(error)"])
    }
  }

  @objc public func get_secure_item(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SecureItemGetArgs.self)
      var query = secureItemBaseQuery(args.key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      if status == errSecSuccess, let data = item as? Data, let s = String(data: data, encoding: .utf8) {
        invoke.resolve(["value": s])
      } else if status == errSecItemNotFound {
        // No entry: empty response. The TS layer treats this as "not stored".
        invoke.resolve([:])
      } else {
        invoke.resolve(["error": "OSStatus \(status)"])
      }
    } catch {
      invoke.resolve(["error": "\(error)"])
    }
  }

  @objc public func clear_secure_item(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SecureItemGetArgs.self)
      let status = SecItemDelete(secureItemBaseQuery(args.key) as CFDictionary)
      if status == errSecSuccess || status == errSecItemNotFound {
        invoke.resolve(["success": true])
      } else {
        invoke.resolve(["success": false, "error": "OSStatus \(status)"])
      }
    } catch {
      invoke.resolve(["success": false, "error": "\(error)"])
    }
  }

  @objc public func show_lookup_popover(_ invoke: Invoke) {
    // Bridge for the system-dictionary "Look Up" surface on iOS.
    // We use `UIReferenceLibraryViewController`, which is the same
    // view UIKit presents for the Look Up callout in editable text
    // views. Two notes:
    //
    //   * The controller refuses to render and `dictionaryHasDefinitionForTerm`
    //     returns false for empty strings, so guard for that explicitly
    //     to keep the rejection path consistent with the Rust models.
    //   * Presentation must happen on the main thread, against a
    //     view controller that's actually in the active window
    //     hierarchy. We reach the foreground scene (matching how
    //     other commands here pick a `keyWindow`) and walk down to
    //     the topmost presented controller so the lookup view sits
    //     above any modal sheet (settings, notebook, etc.) the user
    //     might have open when they tap "dictionary".
    guard let args = try? invoke.parseArgs(ShowLookupPopoverArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }
    let trimmed = args.word.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      return invoke.reject("empty word")
    }

    DispatchQueue.main.async {
      let windows = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
      let keyWindow = windows.first(where: { $0.isKeyWindow }) ?? windows.first
      guard let rootVC = keyWindow?.rootViewController else {
        invoke.reject("no root view controller")
        return
      }
      // Drill past any modally-presented stack so the dictionary
      // view appears on top of (not behind) settings dialogs etc.
      var presenter: UIViewController = rootVC
      while let next = presenter.presentedViewController {
        presenter = next
      }

      // `UIReferenceLibraryViewController` itself doesn't expose
      // dictionary availability, but the static
      // `dictionaryHasDefinitionForTerm:` does. We don't surface
      // "no definition" as an error — Apple's view shows its own
      // "No definition found" / download UI in that case, which is
      // the expected UX. Logging it is enough for diagnostics.
      let hasDefinition = UIReferenceLibraryViewController.dictionaryHasDefinition(forTerm: trimmed)
      if !hasDefinition {
        logger.log("[show_lookup_popover] no built-in dictionary entry for '\(trimmed, privacy: .private)'")
      }

      let dictVC = UIReferenceLibraryViewController(term: trimmed)
      // Constrain the lookup to the lower half of the screen so the
      // book content the user just selected from stays visible above
      // it — the full-screen default feels heavyweight for a quick
      // dictionary glance. On iOS 15+ we use a half-detent sheet
      // presentation: medium height by default, but the user can
      // drag-to-expand to full if they want more room. iPad keeps
      // the form sheet (a native floating panel) since half-screen
      // sheets look out of place on tablet-class screens.
      if UIDevice.current.userInterfaceIdiom == .pad {
        dictVC.modalPresentationStyle = .formSheet
      } else if #available(iOS 15.0, *) {
        dictVC.modalPresentationStyle = .pageSheet
        if let sheet = dictVC.sheetPresentationController {
          sheet.detents = [.medium(), .large()]
          // Default to medium (lower half). The system handles drag
          // to expand to large; we don't need to track changes.
          sheet.selectedDetentIdentifier = .medium
          // Keep the grabber visible so users discover they can
          // expand or drag down to dismiss.
          sheet.prefersGrabberVisible = true
          // Round only the top corners (the standard iOS sheet look).
          sheet.preferredCornerRadius = 16
        }
      } else {
        // iOS 14 and earlier — sheets/detents API doesn't exist; fall
        // back to a centered form sheet so it at least doesn't take
        // the full screen.
        dictVC.modalPresentationStyle = .formSheet
      }
      presenter.present(dictVC, animated: true) {
        invoke.resolve(["success": true])
      }
    }
  }

  /// Open a hidden-but-visible WKWebView at `url`, capture
  /// `document.documentElement.outerHTML` after the page settles, and
  /// resolve with `{ html }`. Implements the mobile half of the
  /// `clip_url` command — see `clip_url.rs` for the desktop half and
  /// `ClipUrlController.swift` for the actual lifecycle.
  @objc public func clip_url(_ invoke: Invoke) {
    let args: ClipUrlArgs
    do {
      args = try invoke.parseArgs(ClipUrlArgs.self)
    } catch {
      invoke.reject(error.localizedDescription)
      return
    }
    DispatchQueue.main.async {
      // Find the topmost view controller to present from. The Tauri
      // root WKWebView lives in the app's key window — present over
      // whatever's currently on top of it (e.g., the library page,
      // a settings sheet) so the user keeps their place after the
      // controller dismisses.
      guard let presenter = topmostViewController() else {
        invoke.reject("Could not find a view controller to present from")
        return
      }

      let controller = ClipUrlController(args: args) { result in
        switch result {
        case .success(let html):
          invoke.resolve(["html": html])
        case .failure(let err):
          invoke.reject(err.message)
        }
      }
      presenter.present(controller, animated: true)
    }
  }

  /// Hold a strong reference to the active folder picker delegate so
  /// it survives until the user dismisses the picker. `present`
  /// only retains the controller; the delegate is `weak` from
  /// `UIDocumentPickerViewController`'s side, so without our retain
  /// it would deallocate immediately and the callbacks would never
  /// fire.
  private var folderPickerDelegate: FolderPickerDelegate?

  /// Bridge for the native-bridge `select_directory` command on iOS.
  /// Mirrors the Android implementation (ACTION_OPEN_DOCUMENT_TREE)
  /// but uses `UIDocumentPickerViewController(forOpeningContentTypes:
  /// [.folder])` — the same picker the system uses for "Files" → choose
  /// folder. Users can navigate into On My iPhone / iCloud Drive /
  /// any third-party file provider and pick a directory there.
  ///
  /// Caveats around iOS sandbox model (callers should be aware):
  ///   * Resolving the returned path on a SUBSEQUENT app launch
  ///     requires a security-scoped bookmark — for now we hold the
  ///     security-scoped resource open for the lifetime of the app
  ///     process so the current session works. v2 should persist a
  ///     bookmark and resolve it on launch; until then a relaunch
  ///     after picking a non-Documents folder may need the user to
  ///     re-pick.
  ///   * The returned `path` is `url.path` — a normal POSIX path.
  ///     Combined with the resource being open, plain Foundation /
  ///     stdlib fs reads work against it.
  @objc public func select_directory(_ invoke: Invoke) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        invoke.reject("plugin deallocated")
        return
      }
      guard let presenter = topmostViewController() else {
        invoke.reject("Could not find a view controller to present from")
        return
      }

      // `forOpeningContentTypes: [.folder]` tells the picker to surface
      // folders as the selectable entries (you can't pick individual
      // files in this mode). `asCopy: false` keeps it a reference into
      // the original location instead of copying into our sandbox.
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
      picker.allowsMultipleSelection = false

      let delegate = FolderPickerDelegate(invoke: invoke) { [weak self] in
        // Drop our strong reference once the picker resolves so the
        // delegate (and thus the closure capture chain) can deallocate.
        // The security-scoped URL resource stays open via
        // `FolderBookmarkStore.persist`, which retains the URL
        // for the rest of the process and writes a bookmark to
        // UserDefaults so the next launch can re-acquire access
        // without prompting the user again.
        self?.folderPickerDelegate = nil
      }
      self.folderPickerDelegate = delegate
      picker.delegate = delegate

      presenter.present(picker, animated: true)
    }
  }

  // iOS devices have no e-ink panel; the "Refresh Page" page-turner action is
  // gated to e-ink Android in the UI, so this is only ever reached defensively.
  // Resolve as a soft no-op rather than rejecting.
  @objc public func refresh_eink_screen(_ invoke: Invoke) {
    invoke.resolve(["success": false])
  }

  @objc public func update_reading_widget(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(UpdateReadingWidgetRequestArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }
    DispatchQueue.global(qos: .utility).async {
      for book in args.books {
        ReadingWidgetWriter.writeThumbnail(hash: book.hash, sourcePath: book.coverPath)
      }
      let snapshot = ReadingWidgetWriter.Snapshot(
        books: args.books.map {
          .init(hash: $0.hash, title: $0.title, author: $0.author, percent: $0.percent)
        },
        sectionTitle: args.sectionTitle,
        emptyTitle: args.emptyTitle
      )
      ReadingWidgetWriter.write(snapshot: snapshot)
      invoke.resolve()
    }
  }

  /// Snapshot a region of the webview for the mesh page-curl texture
  /// (#555). The rect is in CSS pixels of the JS viewport (== points of
  /// the WKWebView). Like Android, the snapshot is capped at 2x CSS
  /// pixels (Pro iPhones render at 3x) and encoded as JPEG — the page is
  /// opaque and JPEG encodes several times faster than PNG, keeping the
  /// dead time between the tap and the first curl frame short. Resolved
  /// as base64 because the plugin boundary is JSON-only; the Rust side
  /// decodes back to bytes.
  @objc public func capture_webview_region(_ invoke: Invoke) {
    guard let args = try? invoke.parseArgs(CaptureWebviewRegionArgs.self) else {
      return invoke.reject("Failed to parse arguments")
    }
    DispatchQueue.main.async { [weak self] in
      guard let webView = self?.webView else {
        return invoke.reject("WebView not available")
      }
      let config = WKSnapshotConfiguration()
      config.rect = CGRect(x: args.x, y: args.y, width: args.width, height: args.height)
      // snapshotWidth is in points and the produced image is snapshotWidth
      // x screen-scale pixels wide, so width x (2 / scale) points yields a
      // 2x-CSS-pixel bitmap on 3x screens and native size elsewhere.
      let scale = webView.window?.screen.scale ?? UIScreen.main.scale
      if scale > 2 {
        config.snapshotWidth = NSNumber(value: args.width * 2.0 / scale)
      }
      webView.takeSnapshot(with: config) { image, error in
        guard let image = image else {
          return invoke.reject(error?.localizedDescription ?? "Snapshot failed")
        }
        // Encode and base64 off the main thread; the completion arrives on
        // main and a full-screen encode is fast but not free.
        DispatchQueue.global(qos: .userInteractive).async {
          guard let data = image.jpegData(compressionQuality: 0.9) else {
            return invoke.reject("JPEG encoding failed")
          }
          invoke.resolve(["data": data.base64EncodedString()])
        }
      }
    }
  }
}

/// Persistent store for security-scoped folder bookmarks.
///
/// `UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`
/// hands us a security-scoped URL whose access right is granted only to
/// the running process. To read the same folder on the *next* launch
/// (without making the user re-pick it every time) we have to:
///
///   1. Right after the pick, call `URL.bookmarkData(.withSecurityScope)`
///      and stash the bytes in `UserDefaults` keyed by the POSIX path.
///   2. On every app launch, walk every persisted bookmark, resolve it
///      back into a URL, and call `startAccessingSecurityScopedResource()`.
///      Hold the URL alive for the entire process so subsequent
///      Foundation / POSIX reads against `url.path` succeed.
///
/// The TS-visible `path` is unchanged across launches, so the rest of
/// the app doesn't need to know about bookmarks — they're an iOS
/// sandbox plumbing detail that lives entirely on the Swift side.
///
/// `isStale` recovery: when the source moves (user renamed, system
/// migrated) `URL(resolvingBookmarkData:..., bookmarkDataIsStale:)`
/// sets `isStale=true` and the new URL still works. We re-encode and
/// rewrite. If the bookmark can't be resolved at all (file deleted,
/// provider gone), we drop the entry — the user will need to re-pick.
enum FolderBookmarkStore {
  /// UserDefaults key prefix; the actual key is "<prefix><path>".
  /// Using the path verbatim keeps debugging straightforward (you can
  /// see the registered folders in `defaults read`), and UserDefaults
  /// keys can contain any valid string.
  private static let keyPrefix = "readest.folderBookmark."

  /// Every URL we've successfully `startAccessingSecurityScopedResource`-ed
  /// during this process, indexed by the POSIX path the JS layer uses.
  /// Held forever (until process exit) — calling `stop` would kill any
  /// subsequent fs read against the path.
  private static var liveAccess: [String: URL] = [:]

  /// Persist a bookmark for `url` so it can be resolved on next launch,
  /// and pre-warm `liveAccess` for the current session.
  static func persist(url: URL) {
    let path = url.path
    do {
      let data = try url.bookmarkData(
        options: .minimalBookmark,
        includingResourceValuesForKeys: nil,
        relativeTo: nil)
      UserDefaults.standard.set(data, forKey: keyPrefix + path)
      liveAccess[path] = url
      logger.log(
        "FolderBookmarkStore: persisted bookmark for \(path, privacy: .public)")
    } catch {
      Logger.error(
        "FolderBookmarkStore: failed to encode bookmark for \(path): \(error)")
    }
  }

  /// Resolve every stored bookmark and start accessing its security-
  /// scoped resource. Called once from `NativeBridgePlugin.load(webview:)`
  /// so all previously-registered folders are reachable before
  /// the WebView begins issuing fs reads.
  static func restoreAllPersisted() {
    let defaults = UserDefaults.standard
    let allKeys = defaults.dictionaryRepresentation().keys.filter {
      $0.hasPrefix(keyPrefix)
    }
    var restored = 0
    var dropped = 0
    for key in allKeys {
      guard let data = defaults.data(forKey: key) else { continue }
      let storedPath = String(key.dropFirst(keyPrefix.count))
      var isStale = false
      do {
        let url = try URL(
          resolvingBookmarkData: data,
          options: [],
          relativeTo: nil,
          bookmarkDataIsStale: &isStale)
        let started = url.startAccessingSecurityScopedResource()
        if started {
          liveAccess[url.path] = url
          restored += 1
        } else {
          // The OS denied access (e.g. file provider revoked). Don't
          // delete the entry — the user may reauthorize the provider
          // in Settings; we'll pick it up on the next launch.
          Logger.error(
            "FolderBookmarkStore: startAccessing denied for \(storedPath)")
        }
        if isStale {
          // Re-encode against the resolved URL so the next launch
          // doesn't have to walk the stale path again.
          if let fresh = try? url.bookmarkData(
            options: .minimalBookmark,
            includingResourceValuesForKeys: nil,
            relativeTo: nil)
          {
            defaults.set(fresh, forKey: key)
          }
        }
      } catch {
        // Bookmark is unrecoverable — folder gone, provider uninstalled,
        // disk reformatted. Drop it from UserDefaults so the next launch
        // doesn't re-attempt it.
        defaults.removeObject(forKey: key)
        dropped += 1
        Logger.error(
          "FolderBookmarkStore: dropped unresolvable bookmark for \(storedPath): \(error)")
      }
    }
    logger.log(
      "FolderBookmarkStore: restored \(restored, privacy: .public) folder(s), dropped \(dropped, privacy: .public)"
    )
  }

  /// Stop accessing and forget the bookmark for `path`. Used when the
  /// JS layer removes a folder from `settings.externalLibraryFolders`.
  /// Currently unused — the v1 UI doesn't expose folder removal — but
  /// kept here so the cleanup contract is obvious from one place.
  static func forget(path: String) {
    if let url = liveAccess.removeValue(forKey: path) {
      url.stopAccessingSecurityScopedResource()
    }
    UserDefaults.standard.removeObject(forKey: keyPrefix + path)
  }
}

/// Delegate for `select_directory`'s `UIDocumentPickerViewController`.
/// We split this out into a dedicated class (rather than making
/// `NativeBridgePlugin` itself the delegate) so multiple concurrent
/// picker invocations would each hold their own state — currently we
/// only allow one at a time, but the wiring is cleaner this way and
/// `Invoke` is easier to capture by reference.
///
/// Lifecycle:
///   1. Plugin retains us strongly via `folderPickerDelegate`.
///   2. UIKit holds us as the picker's `delegate` (weak).
///   3. When the user picks or cancels, we call back into `invoke`
///      and then run `onComplete`, which clears the plugin's strong
///      reference. We deallocate at that point.
///   4. The chosen URL retains its security-scoped access for the
///      remainder of the process via `FolderBookmarkStore`,
///      and is also persisted to UserDefaults so the next launch can
///      re-acquire access without prompting the user again.
private final class FolderPickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let invoke: Invoke
  private let onComplete: () -> Void

  init(invoke: Invoke, onComplete: @escaping () -> Void) {
    self.invoke = invoke
    self.onComplete = onComplete
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    defer { onComplete() }
    guard let url = urls.first else {
      invoke.resolve(["cancelled": true])
      return
    }

    // `startAccessingSecurityScopedResource` is required for any URL
    // returned by the picker that lives outside our sandbox (which is
    // the only interesting case — anything inside our sandbox we
    // already have access to without it). Returns false when no scope
    // is needed or the request was denied; in either case we still
    // try to use the URL because (a) sandbox-internal paths work
    // either way, (b) for denied requests `path` access will surface
    // a normal "permission denied" later, which is a clearer error
    // than failing here pre-emptively.
    let started = url.startAccessingSecurityScopedResource()
    if started {
      // Persist a security-scoped bookmark so the same path is
      // reachable on the next launch, without forcing the user to
      // re-pick it. The store also retains the URL so the resource
      // stays accessible for the remainder of this process.
      FolderBookmarkStore.persist(url: url)
    }

    let result: [String: Any] = [
      "cancelled": false,
      "uri": url.absoluteString,
      "path": url.path,
    ]
    invoke.resolve(result)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    defer { onComplete() }
    invoke.resolve(["cancelled": true])
  }
}

/// Find the visible top-of-stack `UIViewController` so the clip flow
/// can present over whatever the user is looking at. Walks
/// presentedViewController chains and unwraps standard container
/// types (UINavigationController, UITabBarController).
private func topmostViewController() -> UIViewController? {
  let scene =
    UIApplication.shared.connectedScenes
    .compactMap { $0 as? UIWindowScene }
    .first { $0.activationState == .foregroundActive }
    ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
  let window = scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first
  var top = window?.rootViewController
  while let presented = top?.presentedViewController {
    top = presented
  }
  if let nav = top as? UINavigationController { top = nav.visibleViewController ?? nav }
  if let tab = top as? UITabBarController { top = tab.selectedViewController ?? tab }
  return top
}

class SyncPassphraseSetArgs: Decodable {
  let passphrase: String
}

class SecureItemSetArgs: Decodable {
  let key: String
  let value: String
}

class SecureItemGetArgs: Decodable {
  let key: String
}

class ShowLookupPopoverArgs: Decodable {
  let word: String
}

struct UpdateReadingWidgetBookArgs: Decodable {
  let hash: String
  let title: String
  let author: String
  let percent: Int
  let coverPath: String
}
struct UpdateReadingWidgetRequestArgs: Decodable {
  let books: [UpdateReadingWidgetBookArgs]
  let sectionTitle: String
  let emptyTitle: String
}

struct CaptureWebviewRegionArgs: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

@_cdecl("init_plugin_native_bridge")
func initPlugin() -> Plugin {
  return NativeBridgePlugin()
}

/// JS → Swift bridge for the share-extension state. Lives in its own
/// class because WKScriptMessageHandler conformance on NativeBridgePlugin
/// would require routing every message type through the plugin's
/// existing @objc method surface, which is noisier than a dedicated
/// handler. We weakly retain the plugin so the WKWebView's
/// WKUserContentController holding the handler doesn't extend the
/// plugin's lifetime.
private final class ShareBridgeMessageHandler: NSObject, WKScriptMessageHandler {
  private weak var owner: NativeBridgePlugin?
  init(owner: NativeBridgePlugin) { self.owner = owner }
  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == "readestShareBridge" else { return }
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
      return
    }
    if type == "ready" {
      owner?.syncShareExtensionStateFromJS()
    }
  }
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
    webViewLifecycleManager?.handleAppWillResignActive()
    self.originalDelegate?.applicationWillResignActive?(application)
  }

  public func applicationWillEnterForeground(_ application: UIApplication) {
    webViewLifecycleManager?.handleAppWillEnterForeground()
    self.originalDelegate?.applicationWillEnterForeground?(application)
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    webViewLifecycleManager?.handleAppDidEnterBackground()
    self.originalDelegate?.applicationDidEnterBackground?(application)
  }

  public func applicationWillTerminate(_ application: UIApplication) {
    self.originalDelegate?.applicationWillTerminate?(application)
  }
}
