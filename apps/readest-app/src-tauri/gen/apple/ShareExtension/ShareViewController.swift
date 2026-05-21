// Share Extension for Readest: catches an article URL from any iOS share
// sheet (Safari, Chrome, third-party browsers) and forwards it to the
// main app via the existing `readest://` URL scheme. The main app's
// `tauri-plugin-deep-link` integration emits an `onOpenUrl` event,
// `useAppUrlIngress` re-broadcasts it as `app-incoming-url`, and
// `useClipUrlIngress` clips + ingests the article through the same
// pipeline the in-app "From Web URL" entry uses.

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {

  // Single-shot: avoid double-firing if iOS re-presents the extension.
  private var didCompleteOnce = false

  override func viewDidLoad() {
    super.viewDidLoad()
    NSLog("[ReadestShare] viewDidLoad")
    // Kick the work as early as possible — iOS 26 sometimes dismisses
    // the extension before `viewDidAppear` fires when the activation
    // rule matches a single URL exactly. Running from `viewDidLoad`
    // gives us the longest possible window.
    Task { await processInput() }
  }

  /// Walk the inputItems for a URL or text payload and forward it.
  /// Cancels the extension if no URL was found.
  private func processInput() async {
    NSLog("[ReadestShare] processInput started")
    guard let context = extensionContext else {
      NSLog("[ReadestShare] no extensionContext, bailing")
      return
    }
    let items = (context.inputItems.compactMap { $0 as? NSExtensionItem })
    NSLog("[ReadestShare] inputItems count=\(items.count)")

    let url = await firstShareableURL(from: items)
    if let url = url {
      NSLog("[ReadestShare] found URL: \(url.absoluteString)")
      await openInMainApp(url: url)
    } else {
      NSLog("[ReadestShare] no URL found in any inputItem")
    }
    await MainActor.run {
      if !self.didCompleteOnce {
        self.didCompleteOnce = true
        NSLog("[ReadestShare] completing extension request")
        context.completeRequest(returningItems: [], completionHandler: nil)
      }
    }
  }

  /// Probe attachments for the first usable URL. Prefers a real
  /// `public.url` attachment; falls back to scanning a `public.plain-text`
  /// payload for an http(s) substring (some apps share "Title\nURL").
  private func firstShareableURL(from items: [NSExtensionItem]) async -> URL? {
    for (itemIdx, item) in items.enumerated() {
      guard let attachments = item.attachments else { continue }
      NSLog("[ReadestShare] item[\(itemIdx)] has \(attachments.count) attachments")
      for (attIdx, attachment) in attachments.enumerated() {
        NSLog(
          "[ReadestShare] attachment[\(attIdx)] types: \(attachment.registeredTypeIdentifiers)")
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
    if let data = item as? Data,
      let str = String(data: data, encoding: .utf8)
    {
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

  /// Open Readest with the article URL. Tries three paths in order:
  ///
  ///   1. `extensionContext.open(_:)` against `readest://clip?url=...`.
  ///      Apple's sanctioned share-extension → host-app handoff for
  ///      custom URL schemes. The main app's `tauri-plugin-deep-link`
  ///      catches the `readest://` scheme.
  ///   2. `extensionContext.open(_:)` against the Universal Link
  ///      `https://web.readest.com/clip?url=...`. Only works when the
  ///      web.readest.com AASA file claims `/clip` for the app —
  ///      currently it likely doesn't, but tried as a defensive
  ///      fallback in case (1) fails on some iOS version.
  ///   3. Responder-chain `openURL:` trick. iOS 26 silently blocks
  ///      this even when `responds(to: selector)` returns true and
  ///      the responder is `UIApplication`, so it's purely a
  ///      last-ditch attempt for older iOS.
  ///
  /// Inner URL gets RFC-3986 percent-encoded so the outer URL's
  /// query parser sees exactly one `?` (separating outer query from
  /// outer path) and exactly one `=` per param. URLComponents alone
  /// is NOT enough — its `.urlQueryAllowed` set permits `=`, `?`,
  /// `&` and leaves them unescaped, which silently breaks the deep-
  /// link parse (the inner URL's first `?s=...` gets promoted to an
  /// outer query param). All log messages use the `%@` format
  /// specifier with the URL passed as an argument so `printf`'s
  /// percent-spec parser doesn't try to interpret the percent-encoded
  /// characters in the URL.
  @MainActor
  private func openInMainApp(url: URL) async {
    // 1. Custom URL scheme via extensionContext.open — the modern
    //    sanctioned path.
    if let target = buildTargetURL(scheme: "readest", host: "clip", inner: url) {
      NSLog("[ReadestShare] trying custom scheme via extensionContext: %@", target.absoluteString)
      if await openViaExtensionContext(target) {
        NSLog("[ReadestShare] custom scheme open succeeded")
        return
      }
      NSLog("[ReadestShare] custom scheme open failed")
    }

    // 2. Universal Link via extensionContext.open.
    if let target = buildTargetURL(
      scheme: "https", host: "web.readest.com", path: "/clip", inner: url)
    {
      NSLog("[ReadestShare] trying universal link: %@", target.absoluteString)
      if await openViaExtensionContext(target) {
        NSLog("[ReadestShare] universal link open succeeded")
        return
      }
      NSLog("[ReadestShare] universal link open failed")
    }

    // 3. Responder-chain — usually blocked on iOS 26 but tried for
    //    completeness so older devices still get the handoff.
    if let target = buildTargetURL(scheme: "readest", host: "clip", inner: url) {
      NSLog("[ReadestShare] trying responder-chain: %@", target.absoluteString)
      openViaResponderChain(target)
    }
  }

  /// Build a target URL like `<scheme>://<host><path>?url=<inner>`.
  /// Hand-encodes the inner URL against the RFC 3986 "unreserved" set
  /// (alnum + `-._~`) so every URL-significant character — including
  /// `?`, `&`, `=`, `:`, `/`, `#` — gets percent-encoded. See
  /// `openInMainApp` for why URLComponents alone is insufficient.
  private func buildTargetURL(scheme: String, host: String, path: String = "", inner: URL) -> URL?
  {
    let unreserved = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    guard
      let encoded = inner.absoluteString.addingPercentEncoding(withAllowedCharacters: unreserved)
    else { return nil }
    return URL(string: "\(scheme)://\(host)\(path)?url=\(encoded)")
  }

  @MainActor
  private func openViaExtensionContext(_ url: URL) async -> Bool {
    await withCheckedContinuation { continuation in
      guard let ctx = extensionContext else {
        continuation.resume(returning: false)
        return
      }
      ctx.open(url, completionHandler: { success in
        continuation.resume(returning: success)
      })
    }
  }

  private func openViaResponderChain(_ url: URL) {
    var responder: UIResponder? = self
    let selector = sel_registerName("openURL:")
    while let r = responder {
      if r.responds(to: selector) {
        _ = r.perform(selector, with: url)
        NSLog("[ReadestShare] responder-chain openURL: invoked on \(type(of: r))")
        return
      }
      responder = r.next
    }
    NSLog("[ReadestShare] responder-chain found no responder for openURL:")
  }
}
