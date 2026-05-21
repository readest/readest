import UIKit
import WebKit
import os

private let clipLogger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "ClipUrl")

/// Args decoded from the JS `invoke('clip_url', { ... })` payload.
/// Mirrors `ClipOptions` in `clip_url.rs` field-for-field (camelCase
/// JSON, all-but-`url` optional). The defaults below match the Rust
/// `ClipOptions::*()` accessors — English / dark-palette — so a
/// caller that omits a field still renders sensibly.
class ClipUrlArgs: Decodable {
  let url: String
  let windowTitle: String?
  let overlayTitle: String?
  let loadingStatus: String?
  let capturingStatus: String?
  let savedTitle: String?
  let background: String?
  let foreground: String?

  // Resolved getters with the same fallbacks the Rust impl uses.
  var resolvedOverlayTitle: String { overlayTitle ?? "Saving to Readest" }
  var resolvedLoadingStatus: String { loadingStatus ?? "Loading article…" }
  var resolvedCapturingStatus: String { capturingStatus ?? "Capturing article…" }
  var resolvedBackground: String { background ?? "#1f2024" }
  var resolvedForeground: String { foreground ?? "#f5f5f7" }
}

/// Errors surfaced to the JS caller through `invoke.reject`. Strings
/// match the desktop `clip_url` error vocabulary so callers handling
/// the rejection don't need a separate mobile branch.
enum ClipUrlError: Error {
  case invalidUrl
  case loadFailed(String)
  case timedOut

  var message: String {
    switch self {
    case .invalidUrl: return "Invalid URL"
    case .loadFailed(let detail): return "Could not fetch this page: \(detail)"
    case .timedOut: return "Page took too long to load"
    }
  }
}

/// Full-screen view controller that loads `options.url` in a WKWebView,
/// shows a deliberate "Saving…" overlay over the article render so the
/// user sees expected progress (not a website flashing by), and once
/// `webView(_:didFinish:)` fires + a 3 s settle window passes — long
/// enough for in-flight lazy-loaders / Cloudflare-style JS challenges
/// to resolve — captures `document.documentElement.outerHTML` and
/// hands it back via the completion handler.
///
/// Mirrors the desktop `clip_url` flow shape: same Chrome UA, same
/// fingerprint mask, same overlay (rendered via Swift here instead of
/// an inline JS user-script — Swift gives us a proper UIView spinner
/// that doesn't get wiped by the page's own hydration).
final class ClipUrlController: UIViewController, WKNavigationDelegate {

  // Real Chrome UA. Tauri's default reports Safari/WKWebView, which
  // sites with aggressive bot detection cross-check against
  // `navigator.*` fingerprints and reject. Same string as the desktop
  // `BROWSER_UA` constant in `clip_url.rs`.
  static let browserUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

  // Total budget from load-start to outerHTML capture. Same as desktop.
  static let hardTimeoutSeconds: TimeInterval = 30
  // Settle delay after `didFinish` so IntersectionObserver-based lazy
  // loaders fire for content already in the viewport.
  static let loadSettleSeconds: TimeInterval = 3

  private let args: ClipUrlArgs
  private let completion: (Result<String, ClipUrlError>) -> Void

  private var webView: WKWebView!
  private var overlayView: UIView!
  private var statusLabel: UILabel!
  private var didFinishOrFail = false
  private var captureFired = false
  private var timeoutWorkItem: DispatchWorkItem?

  init(args: ClipUrlArgs, completion: @escaping (Result<String, ClipUrlError>) -> Void) {
    self.args = args
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
    // Modal full-screen so the overlay covers the chrome and the app
    // behind it doesn't peek through during the brief capture window.
    self.modalPresentationStyle = .fullScreen
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported for ClipUrlController")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    setUpWebView()
    setUpOverlay()
    startCapture()
  }

  // MARK: - Setup

  private func setUpWebView() {
    let config = WKWebViewConfiguration()
    // Inject the same fingerprint-mask script the desktop flow uses,
    // before any page script runs, so `navigator.webdriver` and the
    // window.chrome shape look real to first-party detection code.
    let mask = WKUserScript(
      source: ClipUrlController.fingerprintMaskScript(),
      injectionTime: .atDocumentStart,
      forMainFrameOnly: false
    )
    config.userContentController.addUserScript(mask)

    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = .all
    // Suppress text selection / link previews — purely cosmetic; the
    // overlay covers the page anyway. Defensive, in case the spinner
    // catches a stray tap.
    config.preferences.javaScriptCanOpenWindowsAutomatically = false

    let wv = WKWebView(frame: .zero, configuration: config)
    wv.customUserAgent = ClipUrlController.browserUserAgent
    wv.navigationDelegate = self
    wv.allowsBackForwardNavigationGestures = false
    wv.isOpaque = true
    wv.backgroundColor = UIColor(hexString: args.resolvedBackground) ?? .black
    wv.scrollView.backgroundColor = wv.backgroundColor
    wv.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(wv)
    NSLayoutConstraint.activate([
      wv.topAnchor.constraint(equalTo: view.topAnchor),
      wv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      wv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      wv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    self.webView = wv
  }

  private func setUpOverlay() {
    let bg = UIColor(hexString: args.resolvedBackground) ?? .black
    let fg = UIColor(hexString: args.resolvedForeground) ?? .white
    view.backgroundColor = bg

    let overlay = UIView()
    overlay.backgroundColor = bg
    overlay.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(overlay)
    NSLayoutConstraint.activate([
      overlay.topAnchor.constraint(equalTo: view.topAnchor),
      overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    let spinner = UIActivityIndicatorView(style: .large)
    spinner.color = fg.withAlphaComponent(0.85)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.startAnimating()
    overlay.addSubview(spinner)

    let title = UILabel()
    title.text = args.resolvedOverlayTitle
    title.textColor = fg
    title.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
    title.textAlignment = .center
    title.translatesAutoresizingMaskIntoConstraints = false
    overlay.addSubview(title)

    let status = UILabel()
    status.text = args.resolvedLoadingStatus
    status.textColor = fg.withAlphaComponent(0.7)
    status.font = UIFont.systemFont(ofSize: 13)
    status.textAlignment = .center
    status.numberOfLines = 1
    status.lineBreakMode = .byTruncatingTail
    status.translatesAutoresizingMaskIntoConstraints = false
    overlay.addSubview(status)
    self.statusLabel = status

    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: overlay.centerYAnchor, constant: -28),
      title.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14),
      title.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      title.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 24),
      title.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -24),
      status.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4),
      status.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      status.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.leadingAnchor, constant: 24),
      status.trailingAnchor.constraint(lessThanOrEqualTo: overlay.trailingAnchor, constant: -24),
    ])
    self.overlayView = overlay
  }

  // MARK: - Capture flow

  private func startCapture() {
    guard let url = URL(string: args.url),
      let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https"
    else {
      finish(.failure(.invalidUrl))
      return
    }

    var req = URLRequest(url: url)
    req.setValue(ClipUrlController.browserUserAgent, forHTTPHeaderField: "User-Agent")
    webView.load(req)

    // Hard timeout — fires even if `didFinish` never does (SPA, redirect
    // chain, JS challenge that never resolves). Same 30 s budget as the
    // desktop flow.
    let work = DispatchWorkItem { [weak self] in
      guard let self = self, !self.captureFired else { return }
      clipLogger.warning("clip_url: hard timeout after \(ClipUrlController.hardTimeoutSeconds, privacy: .public)s")
      self.finish(.failure(.timedOut))
    }
    timeoutWorkItem = work
    DispatchQueue.main.asyncAfter(
      deadline: .now() + ClipUrlController.hardTimeoutSeconds, execute: work)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard !didFinishOrFail else { return }
    didFinishOrFail = true
    statusLabel.text = args.resolvedCapturingStatus
    // Settle then capture. Matches the 3 s post-load delay in the
    // desktop init script — long enough for in-flight asset fetches
    // and lazy-load IntersectionObservers to fire.
    DispatchQueue.main.asyncAfter(deadline: .now() + ClipUrlController.loadSettleSeconds) {
      [weak self] in
      self?.captureOuterHtml()
    }
  }

  func webView(
    _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error
  ) {
    if didFinishOrFail { return }
    didFinishOrFail = true
    finish(.failure(.loadFailed(error.localizedDescription)))
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    if didFinishOrFail { return }
    didFinishOrFail = true
    finish(.failure(.loadFailed(error.localizedDescription)))
  }

  private func captureOuterHtml() {
    guard !captureFired else { return }
    captureFired = true
    webView.evaluateJavaScript("document.documentElement.outerHTML") { [weak self] result, error in
      guard let self = self else { return }
      if let html = result as? String, !html.isEmpty {
        clipLogger.log("clip_url: captured \(html.count, privacy: .public) chars")
        self.finish(.success(html))
      } else {
        let detail = error?.localizedDescription ?? "empty HTML"
        self.finish(.failure(.loadFailed(detail)))
      }
    }
  }

  private func finish(_ result: Result<String, ClipUrlError>) {
    timeoutWorkItem?.cancel()
    timeoutWorkItem = nil
    // Stop the WebView before dismissing — otherwise its JS keeps
    // running in the background until ARC tears it down, which on
    // older devices can stutter the dismiss animation.
    webView?.stopLoading()
    webView?.navigationDelegate = nil

    dismiss(animated: true) { [completion] in
      completion(result)
    }
  }

  // MARK: - Inline JS scripts

  /// Same shape as `fingerprint_mask_script()` in `clip_url.rs`. Clears
  /// the `navigator.webdriver` / window.chrome / navigator.languages
  /// signals that obvious bot-detection scripts probe.
  static func fingerprintMaskScript() -> String {
    return """
      (function() {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        } catch (e) {}
        try {
          if (!window.chrome) { window.chrome = { runtime: {} }; }
        } catch (e) {}
        try {
          if (navigator.languages && navigator.languages.length === 0) {
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
          }
        } catch (e) {}
      })();
      """
  }
}

// MARK: - UIColor hex helper

private extension UIColor {
  /// Parse `#rrggbb` (optionally without the `#`) into a UIColor.
  /// Mirrors the Rust-side `parse_hex_color` semantics: returns nil for
  /// anything malformed so the caller falls back to its own default.
  convenience init?(hexString: String) {
    var hex = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex = String(hex.dropFirst()) }
    guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return nil }
    let r = CGFloat((v >> 16) & 0xff) / 255.0
    let g = CGFloat((v >> 8) & 0xff) / 255.0
    let b = CGFloat(v & 0xff) / 255.0
    self.init(red: r, green: g, blue: b, alpha: 1.0)
  }
}
