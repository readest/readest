import UIKit
import WebKit

/// Args decoded from `open_web_browser` — mirrors `WebBrowserRequest` in
/// the plugin's `models.rs`. Every label the chrome renders comes from JS.
final class WebBrowserArgs: Decodable {
  let url: String
  let downloadDir: String
  let background: String?
  let foreground: String?
  let isEink: Bool?
  let labels: [String: String]?

  func label(_ key: String, _ fallback: String) -> String {
    if let value = labels?[key], !value.isEmpty { return value }
    return fallback
  }
}

final class WebBrowserStatusArgs: Decodable {
  let state: String
  let filename: String
  let bookHash: String?
}

struct WebBrowserDownloadEvent {
  let url: String
  let path: String
  let filename: String
  let success: Bool
  let error: String?
}

/// Full-screen in-app browser (#5775): a header bar (close, back, title +
/// host, reload/stop, menu), a 2 px progress line, an import-status banner
/// and a `WKWebView` on the app's default (persistent) data store so logins
/// survive. Downloads are intercepted with `WKDownload` (iOS 14.5+) and
/// written into `args.downloadDir`; the plugin forwards them to JS.
final class WebBrowserController: UIViewController, WKNavigationDelegate, WKUIDelegate,
  WKDownloadDelegate
{
  private let args: WebBrowserArgs
  private let bg: UIColor
  private let fg: UIColor
  private let eink: Bool

  private var webView: WKWebView!
  private let bar = UIView()
  private let titleLabel = UILabel()
  private let hostLabel = UILabel()
  // Assigned once in `setUpBar()`; the KVO observers update them.
  private var closeButton: UIButton?
  private var backButton: UIButton?
  private var reloadButton: UIButton?
  private var menuButton: UIButton?
  private let progressView = UIView()
  private var progressWidth: NSLayoutConstraint!
  private let banner = UIView()
  private let bannerLabel = UILabel()
  private let bannerOpen = UIButton(type: .system)
  private var bannerHeight: NSLayoutConstraint!
  private var bannerHideWork: DispatchWorkItem?
  private var observations: [NSKeyValueObservation] = []
  private var downloadPaths: [ObjectIdentifier: (url: URL, path: URL)] = [:]
  private var openBookHash: String?
  private var finished = false

  var onDownload: ((WebBrowserDownloadEvent) -> Void)?
  var onFinish: ((String?) -> Void)?

  init(args: WebBrowserArgs) {
    self.args = args
    self.bg = UIColor(hexString: args.background ?? "#1f2024") ?? .black
    self.fg = UIColor(hexString: args.foreground ?? "#f5f5f7") ?? .white
    self.eink = args.isEink ?? false
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  deinit {
    observations.forEach { $0.invalidate() }
  }

  override var preferredStatusBarStyle: UIStatusBarStyle {
    isLight(bg) ? .darkContent : .lightContent
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = bg
    setUpBar()
    setUpBanner()
    setUpWebView()
    observe()
    // The plugin rejects unparseable URLs before presenting; this guard
    // only keeps a malformed string from crashing the controller.
    if let url = URL(string: args.url) {
      webView.load(URLRequest(url: url))
    }
  }

  // MARK: - Chrome

  private func iconButton(_ symbol: String, _ labelKey: String, _ fallback: String, _ action: Selector?)
    -> UIButton
  {
    let button = UIButton(type: .system)
    let config = UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)
    button.setImage(UIImage(systemName: symbol, withConfiguration: config), for: .normal)
    button.tintColor = fg
    button.accessibilityLabel = args.label(labelKey, fallback)
    if let action = action {
      button.addTarget(self, action: action, for: .touchUpInside)
    }
    button.translatesAutoresizingMaskIntoConstraints = false
    button.widthAnchor.constraint(equalToConstant: 44).isActive = true
    button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    return button
  }

  private func setUpBar() {
    bar.backgroundColor = bg
    bar.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(bar)

    let close = iconButton("xmark", "close", "Close", #selector(closeTapped))
    let back = iconButton("chevron.backward", "back", "Back", #selector(backTapped))
    let reload = iconButton("arrow.clockwise", "reload", "Reload", #selector(reloadTapped))
    let menu = iconButton("ellipsis", "menu", "More", nil)
    menu.showsMenuAsPrimaryAction = true
    menu.menu = buildMenu()
    [close, back, reload, menu].forEach { bar.addSubview($0) }
    closeButton = close
    backButton = back
    reloadButton = reload
    menuButton = menu

    titleLabel.textColor = fg
    titleLabel.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
    titleLabel.textAlignment = .center
    titleLabel.lineBreakMode = .byTruncatingTail
    hostLabel.textColor = eink ? fg : fg.withAlphaComponent(0.7)
    hostLabel.font = UIFont.systemFont(ofSize: 12)
    hostLabel.textAlignment = .center
    hostLabel.lineBreakMode = .byTruncatingMiddle
    let stack = UIStackView(arrangedSubviews: [titleLabel, hostLabel])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 1
    stack.translatesAutoresizingMaskIntoConstraints = false
    bar.addSubview(stack)

    let hairline = UIView()
    hairline.backgroundColor = eink ? fg : fg.withAlphaComponent(0.15)
    hairline.translatesAutoresizingMaskIntoConstraints = false
    bar.addSubview(hairline)

    progressView.backgroundColor = fg
    progressView.translatesAutoresizingMaskIntoConstraints = false
    bar.addSubview(progressView)
    progressWidth = progressView.widthAnchor.constraint(equalToConstant: 0)

    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: view.topAnchor),
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 52),

      close.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 4),
      close.bottomAnchor.constraint(equalTo: bar.bottomAnchor, constant: -4),
      back.leadingAnchor.constraint(equalTo: close.trailingAnchor),
      back.centerYAnchor.constraint(equalTo: close.centerYAnchor),
      menu.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -4),
      menu.centerYAnchor.constraint(equalTo: close.centerYAnchor),
      reload.trailingAnchor.constraint(equalTo: menu.leadingAnchor),
      reload.centerYAnchor.constraint(equalTo: close.centerYAnchor),

      stack.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: close.centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: back.trailingAnchor, constant: 4),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: reload.leadingAnchor, constant: -4),

      hairline.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
      hairline.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
      hairline.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
      hairline.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),

      progressView.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
      progressView.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
      progressView.heightAnchor.constraint(equalToConstant: 2),
      progressWidth,
    ])
  }

  private func setUpBanner() {
    banner.backgroundColor = eink ? bg : fg.withAlphaComponent(0.08)
    banner.clipsToBounds = true
    banner.translatesAutoresizingMaskIntoConstraints = false
    if eink {
      banner.layer.borderWidth = 1
      banner.layer.borderColor = fg.cgColor
    }
    view.addSubview(banner)

    bannerLabel.textColor = fg
    bannerLabel.font = UIFont.systemFont(ofSize: 13)
    bannerLabel.lineBreakMode = .byTruncatingMiddle
    bannerLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    bannerLabel.translatesAutoresizingMaskIntoConstraints = false
    banner.addSubview(bannerLabel)

    bannerOpen.setTitle(args.label("open", "Open"), for: .normal)
    bannerOpen.setTitleColor(bg, for: .normal)
    bannerOpen.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
    bannerOpen.backgroundColor = fg
    bannerOpen.layer.cornerRadius = 14
    bannerOpen.contentEdgeInsets = UIEdgeInsets(top: 5, left: 14, bottom: 5, right: 14)
    bannerOpen.addTarget(self, action: #selector(openTapped), for: .touchUpInside)
    bannerOpen.isHidden = true
    bannerOpen.translatesAutoresizingMaskIntoConstraints = false
    banner.addSubview(bannerOpen)

    bannerHeight = banner.heightAnchor.constraint(equalToConstant: 0)
    NSLayoutConstraint.activate([
      banner.topAnchor.constraint(equalTo: bar.bottomAnchor),
      banner.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      banner.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bannerHeight,
      bannerLabel.leadingAnchor.constraint(equalTo: banner.leadingAnchor, constant: 16),
      bannerLabel.centerYAnchor.constraint(equalTo: banner.centerYAnchor),
      bannerOpen.leadingAnchor.constraint(
        greaterThanOrEqualTo: bannerLabel.trailingAnchor, constant: 12),
      bannerOpen.trailingAnchor.constraint(equalTo: banner.trailingAnchor, constant: -12),
      bannerOpen.centerYAnchor.constraint(equalTo: banner.centerYAnchor),
    ])
  }

  private func setUpWebView() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.allowsInlineMediaPlayback = true
    let wv = WKWebView(frame: .zero, configuration: config)
    wv.customUserAgent = ClipUrlController.browserUserAgent
    wv.navigationDelegate = self
    wv.uiDelegate = self
    wv.allowsBackForwardNavigationGestures = true
    wv.backgroundColor = bg
    wv.scrollView.backgroundColor = bg
    wv.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(wv)
    NSLayoutConstraint.activate([
      wv.topAnchor.constraint(equalTo: banner.bottomAnchor),
      wv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      wv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      wv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    webView = wv
  }

  private func observe() {
    observations = [
      webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] wv, _ in
        // Hide rather than dim: e-ink cannot render reduced opacity (DESIGN.md §8).
        self?.backButton?.isHidden = !wv.canGoBack
      },
      webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] _, _ in
        guard let self = self else { return }
        self.menuButton?.menu = self.buildMenu()
      },
      webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
        self?.setProgress(wv.estimatedProgress)
      },
      webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] wv, _ in
        self?.setLoading(wv.isLoading)
      },
      webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
        self?.titleLabel.text = wv.title?.isEmpty == false ? wv.title : wv.url?.host
      },
      webView.observe(\.url, options: [.initial, .new]) { [weak self] wv, _ in
        self?.setHost(wv.url)
      },
    ]
  }

  private func buildMenu() -> UIMenu {
    var actions: [UIAction] = []
    if webView?.canGoForward == true {
      actions.append(
        UIAction(
          title: args.label("forward", "Forward"), image: UIImage(systemName: "chevron.forward")
        ) { [weak self] _ in self?.webView.goForward() })
    }
    actions.append(
      UIAction(
        title: args.label("openInBrowser", "Open in Browser"), image: UIImage(systemName: "safari")
      ) { [weak self] _ in
        if let url = self?.webView.url { UIApplication.shared.open(url) }
      })
    actions.append(
      UIAction(title: args.label("copyLink", "Copy Link"), image: UIImage(systemName: "link")) {
        [weak self] _ in UIPasteboard.general.string = self?.webView.url?.absoluteString
      })
    actions.append(
      UIAction(
        title: args.label("signOut", "Sign out of this site"),
        image: UIImage(systemName: "rectangle.portrait.and.arrow.right"), attributes: .destructive
      ) { [weak self] _ in self?.signOutOfSite() })
    return UIMenu(children: actions)
  }

  private func setProgress(_ value: Double) {
    let width = bar.bounds.width * CGFloat(min(max(value, 0), 1))
    progressWidth.constant = width
    progressView.isHidden = value >= 1
  }

  private func setLoading(_ loading: Bool) {
    let config = UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)
    reloadButton?.setImage(
      UIImage(systemName: loading ? "xmark.circle" : "arrow.clockwise", withConfiguration: config),
      for: .normal)
    reloadButton?.accessibilityLabel =
      loading ? args.label("stop", "Stop") : args.label("reload", "Reload")
    if !loading { progressView.isHidden = true }
  }

  private func setHost(_ url: URL?) {
    guard let url = url, let host = url.host else {
      hostLabel.text = nil
      return
    }
    hostLabel.text =
      url.scheme == "https"
      ? "\u{1F512} \(host)" : "\(args.label("notSecure", "Not secure")) \u{00B7} \(host)"
    if titleLabel.text?.isEmpty ?? true { titleLabel.text = host }
  }

  /// Import status pushed from JS via `set_web_browser_status`, or set
  /// locally when a download starts.
  func setStatus(state: String, filename: String, bookHash: String?) {
    bannerHideWork?.cancel()
    let fallback: [String: String] = [
      "downloading": "Downloading", "importing": "Importing", "added": "Added to library",
      "failed": "Import failed", "unsupported": "Not a supported book format",
    ]
    bannerLabel.text = "\(args.label(state, fallback[state] ?? state)) \u{00B7} \(filename)"
    openBookHash = state == "added" ? bookHash : nil
    bannerOpen.isHidden = openBookHash == nil
    bannerHeight.constant = 44
    if eink {
      view.layoutIfNeeded()
    } else {
      UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
    }
    if state != "downloading" && state != "importing" {
      let work = DispatchWorkItem { [weak self] in self?.hideBanner() }
      bannerHideWork = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }
  }

  private func hideBanner() {
    bannerHeight.constant = 0
    bannerOpen.isHidden = true
    if eink {
      view.layoutIfNeeded()
    } else {
      UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
    }
  }

  // MARK: - Actions

  @objc private func closeTapped() { finish(nil) }
  @objc private func backTapped() { webView.goBack() }
  @objc private func reloadTapped() {
    if webView.isLoading { webView.stopLoading() } else { webView.reload() }
  }
  @objc private func openTapped() { finish(openBookHash) }

  /// Remove cookies/storage for the current site only. The data store is
  /// app-wide and shared with Readest's own webview, so never clear all.
  private func signOutOfSite() {
    guard let host = webView.url?.host else { return }
    let store = WKWebsiteDataStore.default()
    let types = WKWebsiteDataStore.allWebsiteDataTypes()
    store.fetchDataRecords(ofTypes: types) { records in
      let matching = records.filter { record in
        host == record.displayName || host.hasSuffix("." + record.displayName)
      }
      store.removeData(ofTypes: types, for: matching) { [weak self] in
        self?.webView.reload()
      }
    }
  }

  private func finish(_ hash: String?) {
    if finished { return }
    finished = true
    bannerHideWork?.cancel()
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    dismiss(animated: true) { [onFinish] in onFinish?(hash) }
  }

  // MARK: - WKNavigationDelegate

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    preferences: WKWebpagePreferences,
    decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
  ) {
    if navigationAction.shouldPerformDownload {
      decisionHandler(.download, preferences)
      return
    }
    guard let url = navigationAction.request.url else {
      decisionHandler(.allow, preferences)
      return
    }
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme != "http" && scheme != "https" && scheme != "about" && scheme != "blob"
      && scheme != "data"
    {
      UIApplication.shared.open(url)
      decisionHandler(.cancel, preferences)
      return
    }
    // target=_blank: keep the user in this browser.
    if navigationAction.targetFrame == nil {
      webView.load(navigationAction.request)
      decisionHandler(.cancel, preferences)
      return
    }
    decisionHandler(.allow, preferences)
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    if navigationResponse.isForMainFrame {
      let disposition =
        (navigationResponse.response as? HTTPURLResponse)?
        .value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
      if !navigationResponse.canShowMIMEType || disposition.hasPrefix("attachment") {
        decisionHandler(.download)
        return
      }
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
  ) {
    download.delegate = self
  }

  func webView(
    _ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload
  ) {
    download.delegate = self
  }

  // MARK: - WKUIDelegate

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if navigationAction.targetFrame?.isMainFrame != true {
      webView.load(navigationAction.request)
    }
    return nil
  }

  // MARK: - WKDownloadDelegate

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse,
    suggestedFilename: String, completionHandler: @escaping (URL?) -> Void
  ) {
    let dir = URL(fileURLWithPath: args.downloadDir, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let name = WebBrowserController.sanitizeFilename(suggestedFilename, fallback: response.url)
    let path = WebBrowserController.uniquePath(in: dir, name: name)
    downloadPaths[ObjectIdentifier(download)] = (response.url ?? dir, path)
    setStatus(state: "downloading", filename: path.lastPathComponent, bookHash: nil)
    completionHandler(path)
  }

  func downloadDidFinish(_ download: WKDownload) {
    guard let entry = downloadPaths.removeValue(forKey: ObjectIdentifier(download)) else { return }
    onDownload?(
      WebBrowserDownloadEvent(
        url: entry.url.absoluteString, path: entry.path.path,
        filename: entry.path.lastPathComponent, success: true, error: nil))
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    guard let entry = downloadPaths.removeValue(forKey: ObjectIdentifier(download)) else { return }
    // Drop the partial file so it does not linger in the cache.
    try? FileManager.default.removeItem(at: entry.path)
    setStatus(state: "failed", filename: entry.path.lastPathComponent, bookHash: nil)
    onDownload?(
      WebBrowserDownloadEvent(
        url: entry.url.absoluteString, path: entry.path.path,
        filename: entry.path.lastPathComponent, success: false, error: error.localizedDescription))
  }

  // MARK: - Helpers

  static func sanitizeFilename(_ suggested: String, fallback: URL?) -> String {
    var raw = suggested.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { raw = fallback?.lastPathComponent ?? "" }
    let reserved: Set<Character> = ["/", "\\", ":", "*", "?", "\"", "<", ">", "|"]
    let cleaned = String(
      raw.map { ch -> Character in
        if reserved.contains(ch) { return "_" }
        if let scalar = ch.unicodeScalars.first, scalar.value < 32 { return "_" }
        return ch
      }
    ).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
    return cleaned.isEmpty ? "download" : cleaned
  }

  static func uniquePath(in dir: URL, name: String) -> URL {
    let first = dir.appendingPathComponent(name)
    if !FileManager.default.fileExists(atPath: first.path) { return first }
    let ext = (name as NSString).pathExtension
    let stem = (name as NSString).deletingPathExtension
    var n = 1
    while true {
      let candidate = dir.appendingPathComponent(
        ext.isEmpty ? "\(stem) (\(n))" : "\(stem) (\(n)).\(ext)")
      if !FileManager.default.fileExists(atPath: candidate.path) { return candidate }
      n += 1
    }
  }

  private func isLight(_ color: UIColor) -> Bool {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    color.getRed(&r, green: &g, blue: &b, alpha: &a)
    return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6
  }
}

// MARK: - UIColor hex helper

// `ClipUrlController.swift` declares the same initializer as a *file-private*
// extension, so it is invisible here. Duplicated rather than widened to keep
// this change inside the browser files; lifting that one to `internal` and
// deleting this copy is a one-line follow-up.
private extension UIColor {
  /// Parse `#rrggbb` (optionally without the `#`) into a UIColor; nil for
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
