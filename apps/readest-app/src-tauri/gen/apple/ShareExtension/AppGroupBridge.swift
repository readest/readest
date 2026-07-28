// Shared App Group container schema between the Readest Share Extension and
// the host app. Keep this file in sync with the mirror at
// `src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/AppGroupBridge.swift`.
// Two NSUserDefaults keys form the contract:
//
//   shareExtensionGroups       (host → extension)
//     JSON array of { id: String, name: String }. Library groups the user
//     can pick when saving. Refreshed by the host every time it foregrounds.
//
//   shareExtensionDefaultGroupName (host → extension)
//     User-locale-translated label for the "no group" row at the top of
//     the picker. JS supplies `t('Default')` so the extension doesn't
//     need its own per-locale strings file.
//
//   shareExtensionPendingSaves (extension → host)
//     JSON array of { url, groupId?, groupName?, addedAt, htmlFile? }
//     (addedAt is an ISO-8601 string). The extension appends here on every
//     Save. The host drains + clears on foreground and feeds each entry
//     through the same clip-and-import path the in-app "From Web URL"
//     entry uses. `htmlFile` names a page-HTML capture in the App Group
//     `SharedClips/` directory (Safari shares with the JS preprocessor);
//     the host converts it directly instead of re-fetching the URL.

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

  // ISO-8601 with fractional seconds — round-trips cleanly through
  // JavaScript's Date constructor on the JS side.
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
