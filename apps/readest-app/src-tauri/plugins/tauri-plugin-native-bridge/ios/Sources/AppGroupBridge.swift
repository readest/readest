// Mirror of `src-tauri/gen/apple/ShareExtension/AppGroupBridge.swift`. The
// two targets cannot share Swift source via the Xcode project layout we
// use (xcodegen `sources:` blocks scope strictly to each target's
// directory), so the schema is intentionally duplicated. Keep both files
// byte-aligned when changing field names, keys, or encodings.

import Foundation

enum AppGroupBridge {
  static let suiteName = "group.com.bilingify.readest"
  static let groupsKey = "shareExtensionGroups"
  static let defaultGroupNameKey = "shareExtensionDefaultGroupName"
  static let pendingSavesKey = "shareExtensionPendingSaves"

  static var defaults: UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }

  struct LibraryGroup: Codable, Equatable {
    let id: String
    let name: String
  }

  struct PendingSave: Codable, Equatable {
    let url: String
    let groupId: String?
    let groupName: String?
    let addedAt: String
    /// Bare file name of a page-HTML capture in `SharedClips/` — present
    /// when the share came from Safari with the JS preprocessor, so the
    /// host can convert the signed-in tab's DOM without re-fetching.
    let htmlFile: String?
  }

  static func readGroups() -> [LibraryGroup] {
    guard let data = defaults?.data(forKey: groupsKey) else { return [] }
    return (try? JSONDecoder().decode([LibraryGroup].self, from: data)) ?? []
  }

  static func writeGroups(_ groups: [LibraryGroup]) {
    guard let data = try? JSONEncoder().encode(groups) else { return }
    defaults?.set(data, forKey: groupsKey)
  }

  /// JS side passes the user-locale-translated "Default" label here so the
  /// Share Extension's no-group row reads in the user's language without
  /// the extension needing its own per-locale strings file.
  static func readDefaultGroupName() -> String? {
    defaults?.string(forKey: defaultGroupNameKey)
  }

  static func writeDefaultGroupName(_ name: String) {
    defaults?.set(name, forKey: defaultGroupNameKey)
  }

  static func readPendingSaves() -> [PendingSave] {
    guard let data = defaults?.data(forKey: pendingSavesKey) else { return [] }
    return (try? JSONDecoder().decode([PendingSave].self, from: data)) ?? []
  }

  static func appendPendingSave(_ save: PendingSave) {
    var saves = readPendingSaves()
    saves.append(save)
    if let data = try? JSONEncoder().encode(saves) {
      defaults?.set(data, forKey: pendingSavesKey)
    }
  }

  static func clearPendingSaves() {
    defaults?.removeObject(forKey: pendingSavesKey)
  }

  static func nowIso8601() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date())
  }

  // ── Shared clip HTML files (extension writes, host reads) ──────────

  static var sharedClipsDirectory: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: suiteName)?
      .appendingPathComponent("SharedClips", isDirectory: true)
  }

  /// Persist captured page HTML into the App Group container. Returns the
  /// bare file name for the PendingSave payload, or nil on any failure —
  /// callers fall back to the URL-only save.
  static func writeSharedClipHtml(_ html: String) -> String? {
    guard let dir = sharedClipsDirectory else { return nil }
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let name = UUID().uuidString + ".html"
      try html.write(to: dir.appendingPathComponent(name), atomically: true, encoding: .utf8)
      return name
    } catch {
      return nil
    }
  }

  /// Read + delete a shared clip file (single-shot). Rejects anything that
  /// isn't a bare file name so a malformed payload can't escape the
  /// SharedClips directory.
  static func takeSharedClipHtml(fileName: String) -> String? {
    guard !fileName.isEmpty, !fileName.contains("/"), !fileName.contains("\\"),
      !fileName.contains(".."), let dir = sharedClipsDirectory
    else { return nil }
    let file = dir.appendingPathComponent(fileName)
    let html = try? String(contentsOf: file, encoding: .utf8)
    try? FileManager.default.removeItem(at: file)
    return html
  }
}
