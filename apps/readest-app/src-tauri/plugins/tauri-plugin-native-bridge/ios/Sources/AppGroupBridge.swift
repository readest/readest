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
}
