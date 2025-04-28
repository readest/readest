import AVFoundation
import AuthenticationServices
import CoreText
import MediaPlayer
import ObjectiveC
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

class InterceptKeysRequestArgs: Decodable {
  let backKey: Bool?
  let volumeKeys: Bool?
}

class VolumeKeyHandler: NSObject {
  private var audioSession: AVAudioSession?
  private var originalVolume: Float = 0.0
  private var volumeView: MPVolumeView?
  private var isIntercepting = false
  private var webView: WKWebView?
  private var volumeSlider: UISlider?

  func startInterception(webView: WKWebView) {
    if isIntercepting {
      return
    }

    self.webView = webView
    isIntercepting = true

    audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession?.setActive(true)
    } catch {
      print("Failed to activate audio session: \(error)")
    }

    originalVolume = audioSession?.outputVolume ?? 0.1

    DispatchQueue.main.async { [weak self] in
      self?.setupHiddenVolumeView()
    }

    audioSession?.addObserver(self, forKeyPath: "outputVolume", options: [.new], context: nil)
  }

  func stopInterception() {
    if !isIntercepting {
      return
    }

    isIntercepting = false
    audioSession?.removeObserver(self, forKeyPath: "outputVolume")
    DispatchQueue.main.async { [weak self] in
      self?.setSystemVolume(self?.originalVolume ?? 0.1)
      self?.volumeView?.removeFromSuperview()
      self?.volumeView = nil
      self?.volumeSlider = nil
    }

    do {
      try audioSession?.setActive(false)
    } catch {
      print("Failed to deactivate audio session: \(error)")
    }
  }

  private func setSystemVolume(_ volume: Float) {
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
    setSystemVolume(originalVolume)
  }

  override func observeValue(
    forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?,
    context: UnsafeMutableRawPointer?
  ) {
    if keyPath == "outputVolume", let audioSession = self.audioSession, isIntercepting {
      let currentVolume = audioSession.outputVolume

      if currentVolume > originalVolume {
        DispatchQueue.main.async { [weak self] in
          self?.webView?.evaluateJavaScript(
            "window.onNativeKeyDown('VolumeUp');", completionHandler: nil)
          self?.setSystemVolume(self?.originalVolume ?? 0.1)
        }
      } else if currentVolume < originalVolume {
        DispatchQueue.main.async { [weak self] in
          self?.webView?.evaluateJavaScript(
            "window.onNativeKeyDown('VolumeDown');", completionHandler: nil)
          self?.setSystemVolume(self?.originalVolume ?? 0.1)
        }
      }
    }
  }
}

class NativeBridgePlugin: Plugin {
  private var authSession: ASWebAuthenticationSession?
  private var webView: WKWebView?

  @objc public override func load(webview: WKWebView) {
    self.webView = webview
    print("NativeBridgePlugin loaded")
  }

  private struct AssociatedKeys {
    static var volumeKeyHandler = "volumeKeyHandler"
    static var interceptingVolumeKeys = "interceptingVolumeKeys"
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

  private func interceptVolumeKeys(_ intercept: Bool) {
    interceptingVolumeKeys = intercept

    if intercept {
      if volumeKeyHandler == nil {
        volumeKeyHandler = VolumeKeyHandler()
      }

      if let webView = self.webView {
        volumeKeyHandler?.startInterception(webView: webView)
      }
    } else {
      volumeKeyHandler?.stopInterception()
    }
  }

  @objc public func intercept_keys(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(InterceptKeysRequestArgs.self)

      if let volumeKeys = args.volumeKeys {
        DispatchQueue.main.async { [weak self] in
          self?.interceptVolumeKeys(volumeKeys)
        }
      }

      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
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
