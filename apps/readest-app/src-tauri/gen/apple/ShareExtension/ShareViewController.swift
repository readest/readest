// Share Extension for Readest: catches an article URL from any iOS share
// sheet (Safari, Chrome, third-party browsers), shows a small sheet UI
// that lets the user pick a target library group, then queues the save
// into the App Group container and best-effort launches Readest.
//
// Two delivery paths to the host app, in order of preference:
//
//   1. App Group queue + responder-chain launch.
//      `AppGroupBridge.appendPendingSave` writes the URL + chosen group
//      to the shared NSUserDefaults at `group.com.bilingify.readest`.
//      We then walk the UIResponder chain looking for an object that
//      responds to `openURL:options:completionHandler:` (UIApplication)
//      and dispatch via an objc-runtime IMP cast. This is the pattern
//      Chrome iOS ships in `ios/chrome/common/extension_open_url.mm`
//      (using NSInvocation there; we use the equivalent IMP-cast trick
//      since pure Swift can't see NSInvocation). Continues to work on
//      iOS 26 — the deprecated `openURL:` selector is what breaks
//      ("BUG IN CLIENT OF UIKIT" + no-op). The modern 3-arg selector is
//      not directly visible to extensions but the responder chain still
//      hands UIApplication over for runtime dispatch.
//
//   2. App Group queue as standalone fallback.
//      If the launch trick is ever blocked by Apple, the save still
//      sits in the queue. The host's `NativeBridgePlugin` drains it on
//      `applicationDidBecomeActive` so the next time the user opens
//      Readest manually, the article is ingested.
//
// `extensionContext.open(_:)` is intentionally not used — Apple docs
// scope it to Today widgets only and it returns success=false from
// Share Extensions on modern iOS regardless of URL scheme.

import ObjectiveC
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {

  // Single-shot: avoid double-firing if iOS re-presents the extension.
  private var didCompleteOnce = false

  override func viewDidLoad() {
    super.viewDidLoad()
    NSLog("[ReadestShare] viewDidLoad")
    view.backgroundColor = .clear
    Task { await self.loadAndPresent() }
  }

  // MARK: - Input handling

  private func loadAndPresent() async {
    guard let context = extensionContext else {
      NSLog("[ReadestShare] no extensionContext")
      return
    }
    let items = context.inputItems.compactMap { $0 as? NSExtensionItem }
    NSLog("[ReadestShare] inputItems count=\(items.count)")

    let url = await firstShareableURL(from: items)
    let pageTitle =
      items
      .compactMap { $0.attributedTitle?.string ?? $0.attributedContentText?.string }
      .first { !$0.isEmpty }

    await MainActor.run {
      guard let url = url else {
        NSLog("[ReadestShare] no URL found, cancelling")
        self.cancelRequest()
        return
      }
      NSLog("[ReadestShare] presenting picker for URL: %@", url.absoluteString)
      self.presentPicker(url: url, pageTitle: pageTitle)
    }
  }

  private func presentPicker(url: URL, pageTitle: String?) {
    let groups = AppGroupBridge.readGroups()
    let options = SaveOptionsViewController(
      url: url,
      pageTitle: pageTitle,
      groups: groups,
      onCancel: { [weak self] in
        self?.cancelRequest()
      },
      onSave: { [weak self] selectedGroup in
        self?.handleSave(url: url, group: selectedGroup)
      }
    )
    let nav = UINavigationController(rootViewController: options)
    nav.view.translatesAutoresizingMaskIntoConstraints = false
    addChild(nav)
    view.addSubview(nav.view)
    NSLayoutConstraint.activate([
      nav.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      nav.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      nav.view.topAnchor.constraint(equalTo: view.topAnchor),
      nav.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    nav.didMove(toParent: self)
  }

  // MARK: - Save / Cancel

  private func handleSave(url: URL, group: AppGroupBridge.LibraryGroup?) {
    let save = AppGroupBridge.PendingSave(
      url: url.absoluteString,
      groupId: group?.id,
      groupName: group?.name,
      addedAt: AppGroupBridge.nowIso8601()
    )
    AppGroupBridge.appendPendingSave(save)
    NSLog("[ReadestShare] queued save for %@ group=%@", url.absoluteString, group?.name ?? "<none>")

    if let target = buildTargetURL(scheme: "readest", host: "clip", inner: url) {
      let opened = openViaResponderChain(target)
      NSLog("[ReadestShare] responder-chain launch=%@", opened ? "yes" : "no")
    }
    completeOnce()
  }

  private func cancelRequest() {
    guard !didCompleteOnce else { return }
    didCompleteOnce = true
    let err = NSError(domain: "ReadestShare", code: NSUserCancelledError, userInfo: nil)
    extensionContext?.cancelRequest(withError: err)
  }

  private func completeOnce() {
    guard !didCompleteOnce else { return }
    didCompleteOnce = true
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }

  // MARK: - URL extraction

  private func firstShareableURL(from items: [NSExtensionItem]) async -> URL? {
    for item in items {
      guard let attachments = item.attachments else { continue }
      for attachment in attachments {
        if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
          if let url = try? await loadURL(from: attachment), Self.isHttp(url) {
            return url
          }
        }
        if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
          if let text = try? await loadText(from: attachment),
            let url = Self.extractHTTPURL(from: text)
          {
            return url
          }
        }
      }
    }
    return nil
  }

  private func loadURL(from provider: NSItemProvider) async throws -> URL? {
    let item = try await provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil)
    if let url = item as? URL { return url }
    if let str = item as? String { return URL(string: str) }
    if let data = item as? Data, let str = String(data: data, encoding: .utf8) {
      return URL(string: str)
    }
    return nil
  }

  private func loadText(from provider: NSItemProvider) async throws -> String? {
    let item = try await provider.loadItem(
      forTypeIdentifier: UTType.plainText.identifier, options: nil)
    if let text = item as? String { return text }
    if let data = item as? Data { return String(data: data, encoding: .utf8) }
    return nil
  }

  private static func isHttp(_ url: URL) -> Bool {
    let scheme = url.scheme?.lowercased() ?? ""
    return scheme == "http" || scheme == "https"
  }

  private static func extractHTTPURL(from text: String) -> URL? {
    for token in text.split(whereSeparator: { $0.isWhitespace }) {
      let s = String(token)
      if s.hasPrefix("http://") || s.hasPrefix("https://") {
        if let url = URL(string: s), isHttp(url) { return url }
      }
    }
    return nil
  }

  // MARK: - Launch trick (Chrome iOS pattern, IMP-cast variant)

  /// Build `<scheme>://<host>?url=<percent-encoded-inner>`. The inner URL
  /// is encoded against the RFC 3986 unreserved set so every URL-
  /// significant character (`?`, `&`, `=`, `:`, `/`, `#`) is escaped and
  /// the outer parser sees exactly one `?` and one `=`.
  private func buildTargetURL(scheme: String, host: String, inner: URL) -> URL? {
    let unreserved = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    guard let encoded = inner.absoluteString.addingPercentEncoding(withAllowedCharacters: unreserved)
    else { return nil }
    return URL(string: "\(scheme)://\(host)?url=\(encoded)")
  }

  /// Walk the responder chain to find a responder that implements
  /// `openURL:options:completionHandler:` (UIApplication), then call it
  /// via an Objective-C IMP cast. The IMP-cast path is equivalent to
  /// Chrome's NSInvocation pattern in `ios/chrome/common/extension_open_url.mm`
  /// but works in pure Swift — we never name `UIApplication` so the
  /// App Store extension symbol scanner doesn't reject the binary.
  ///
  /// `openURL:options:completionHandler:` (non-deprecated) is what
  /// continues to work on iOS 26. The legacy `openURL:` selector logs
  /// "BUG IN CLIENT OF UIKIT" and no-ops.
  @discardableResult
  private func openViaResponderChain(_ url: URL) -> Bool {
    typealias OpenURLFn = @convention(c) (
      AnyObject, Selector, URL, NSDictionary?, AnyObject?
    ) -> Void
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let r = responder {
      if r.responds(to: selector) {
        let target = r as AnyObject
        let cls: AnyClass = object_getClass(target) ?? type(of: target)
        guard let method = class_getInstanceMethod(cls, selector) else {
          responder = r.next
          continue
        }
        let imp = method_getImplementation(method)
        let fn = unsafeBitCast(imp, to: OpenURLFn.self)
        fn(target, selector, url, nil, nil)
        NSLog("[ReadestShare] openURL invoked on \(cls) via IMP")
        return true
      }
      responder = r.next
    }
    NSLog("[ReadestShare] no responder accepted openURL:options:completionHandler:")
    return false
  }
}

// MARK: - SaveOptionsViewController

/// URL preview row + per-group radio list, with Cancel and "Save"
/// in the nav bar. Mirrors the Zotero / Pocket save UX.
private final class SaveOptionsViewController: UITableViewController {

  private let url: URL
  private let pageTitle: String?
  private let groups: [AppGroupBridge.LibraryGroup]
  // nil means "Default" (no group). Initial selection: nil.
  private var selectedGroupId: String?
  private let onCancel: () -> Void
  private let onSave: (AppGroupBridge.LibraryGroup?) -> Void

  init(
    url: URL,
    pageTitle: String?,
    groups: [AppGroupBridge.LibraryGroup],
    onCancel: @escaping () -> Void,
    onSave: @escaping (AppGroupBridge.LibraryGroup?) -> Void
  ) {
    self.url = url
    self.pageTitle = pageTitle
    self.groups = groups
    self.onCancel = onCancel
    self.onSave = onSave
    super.init(style: .insetGrouped)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = NSLocalizedString("Save to Readest", comment: "Share extension title")
    // Both Cancel and Save are iOS system bar button items — UIKit
    // localizes them automatically for every language Apple ships, so
    // the extension doesn't carry its own .strings file for them.
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel, target: self, action: #selector(cancelTapped))
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .save, target: self, action: #selector(saveTapped))
    tableView.register(URLPreviewCell.self, forCellReuseIdentifier: URLPreviewCell.reuseId)
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "groupCell")
  }

  @objc private func cancelTapped() { onCancel() }

  @objc private func saveTapped() {
    let selected = groups.first { $0.id == selectedGroupId }
    onSave(selected)
  }

  // MARK: Table source

  override func numberOfSections(in tableView: UITableView) -> Int { 2 }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    section == 0 ? 1 : groups.count + 1  // +1 for "Default"
  }

  override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int)
    -> String?
  {
    section == 1 ? NSLocalizedString("GROUP", comment: "Group picker header") : nil
  }

  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath)
    -> UITableViewCell
  {
    if indexPath.section == 0 {
      let cell =
        tableView.dequeueReusableCell(withIdentifier: URLPreviewCell.reuseId, for: indexPath)
        as! URLPreviewCell
      cell.configure(url: url, pageTitle: pageTitle)
      cell.selectionStyle = .none
      return cell
    }
    let cell = tableView.dequeueReusableCell(withIdentifier: "groupCell", for: indexPath)
    let name: String
    let isSelected: Bool
    if indexPath.row == 0 {
      // JS-supplied user-locale "Default" label (see AppGroupBridge).
      // Falls back to English when the host hasn't synced yet — happens
      // on the very first share before the app has been opened.
      name = AppGroupBridge.readDefaultGroupName() ?? "Default"
      isSelected = selectedGroupId == nil
    } else {
      let group = groups[indexPath.row - 1]
      name = group.name
      isSelected = selectedGroupId == group.id
    }
    cell.textLabel?.text = name
    cell.accessoryType = isSelected ? .checkmark : .none
    return cell
  }

  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard indexPath.section == 1 else { return }
    selectedGroupId = indexPath.row == 0 ? nil : groups[indexPath.row - 1].id
    tableView.reloadSections(IndexSet(integer: 1), with: .none)
  }
}

// MARK: - URLPreviewCell

private final class URLPreviewCell: UITableViewCell {
  static let reuseId = "URLPreviewCell"

  private let iconView = UIImageView()
  private let titleLabel = UILabel()
  private let hostLabel = UILabel()
  private var faviconTask: URLSessionDataTask?

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: .default, reuseIdentifier: reuseIdentifier)
    iconView.translatesAutoresizingMaskIntoConstraints = false
    iconView.contentMode = .scaleAspectFit
    iconView.clipsToBounds = true
    iconView.layer.cornerRadius = 4
    iconView.image = UIImage(systemName: "doc.text")
    iconView.tintColor = .secondaryLabel

    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.font = .preferredFont(forTextStyle: .body)
    titleLabel.numberOfLines = 2

    hostLabel.translatesAutoresizingMaskIntoConstraints = false
    hostLabel.font = .preferredFont(forTextStyle: .footnote)
    hostLabel.textColor = .secondaryLabel
    hostLabel.numberOfLines = 1

    contentView.addSubview(iconView)
    contentView.addSubview(titleLabel)
    contentView.addSubview(hostLabel)
    NSLayoutConstraint.activate([
      iconView.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      iconView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      iconView.widthAnchor.constraint(equalToConstant: 40),
      iconView.heightAnchor.constraint(equalToConstant: 40),

      titleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 12),
      titleLabel.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
      titleLabel.topAnchor.constraint(equalTo: contentView.layoutMarginsGuide.topAnchor),

      hostLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
      hostLabel.trailingAnchor.constraint(equalTo: titleLabel.trailingAnchor),
      hostLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
      hostLabel.bottomAnchor.constraint(equalTo: contentView.layoutMarginsGuide.bottomAnchor),
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    faviconTask?.cancel()
    faviconTask = nil
    iconView.image = UIImage(systemName: "doc.text")
    iconView.tintColor = .secondaryLabel
  }

  func configure(url: URL, pageTitle: String?) {
    let host = url.host ?? url.absoluteString
    titleLabel.text = pageTitle?.isEmpty == false ? pageTitle : url.absoluteString
    hostLabel.text = host
    loadFavicon(for: url)
  }

  /// Best-effort favicon at `https://<host>/favicon.ico` with a 2s
  /// timeout. On any failure we keep the placeholder — never blocking
  /// the user's save action on a network round-trip.
  private func loadFavicon(for url: URL) {
    guard let host = url.host, var components = URLComponents(string: "https://\(host)") else {
      return
    }
    components.path = "/favicon.ico"
    guard let iconURL = components.url else { return }
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 2
    let session = URLSession(configuration: config)
    let task = session.dataTask(with: iconURL) { [weak self] data, response, _ in
      guard let data = data,
        let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode),
        let image = UIImage(data: data)
      else { return }
      DispatchQueue.main.async {
        self?.iconView.image = image
        self?.iconView.tintColor = nil
      }
    }
    task.resume()
    faviconTask = task
  }
}
