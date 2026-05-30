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
//     JSON array of { url, groupId?, groupName?, addedAt } (ISO-8601 string).
//     The extension appends here on every Save. The host drains + clears on
//     foreground and feeds each entry through the same clip-and-import path
//     the in-app "From Web URL" entry uses.

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
}
