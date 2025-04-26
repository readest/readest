import AVFoundation
import AuthenticationServices
import CoreText
import MediaPlayer
import SwiftRs
import Tauri
import UIKit
import WebKit

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

class NativeBridgePlugin: Plugin {
  private var authSession: ASWebAuthenticationSession?

  @objc public func use_background_audio(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(UseBackgroundAudioRequestArgs.self)
      let enabled = args.enabled
      let session = AVAudioSession.sharedInstance()
      if enabled {
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
        print("AVAudioSession activated")
      } else {
        try session.setActive(false)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        print("AVAudioSession deactivated")
      }
      invoke.resolve()
    } catch {
      print("Failed to set up audio session:", error)
    }
  }

  @objc public func auth_with_safari(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SafariAuthRequestArgs.self)
    let authUrl = URL(string: args.authUrl)!

    authSession = ASWebAuthenticationSession(url: authUrl, callbackURLScheme: "readest") {
      [weak self] callbackURL, error in
      guard let strongSelf = self else { return }

      if let error = error {
        Logger.error("Auth session error: \(error.localizedDescription)")
        invoke.reject(error.localizedDescription)
        return
      }

      if let callbackURL = callbackURL {
        Logger.info("Auth session callback URL: \(callbackURL.absoluteString)")
        strongSelf.authSession?.cancel()
        strongSelf.authSession = nil
        invoke.resolve(["redirectUrl": callbackURL.absoluteString])
      }
    }

    if #available(iOS 13.0, *) {
      authSession?.presentationContextProvider = self
    }

    let started = authSession?.start() ?? false
    Logger.info("Auth session start result: \(started)")
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
        print("No key window found")
      }
    }
    invoke.resolve(["success": true])
  }

  @objc public func get_sys_fonts_list(_ invoke: Invoke) throws {
    var fontList: [String] = []

    for family in UIFont.familyNames.sorted() {
      if let localized = getLocalizedDisplayName(familyName: family) {
        fontList.append(localized)
      } else {
        let fontNames = UIFont.fontNames(forFamilyName: family)
        if fontNames.isEmpty {
          fontList.append(family)
        } else {
          fontList.append(contentsOf: fontNames)
        }
      }
    }

    invoke.resolve(["fonts": fontList])
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
