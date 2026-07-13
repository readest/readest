import CarPlay
import MediaPlayer
import UIKit

// CarPlay scene for TTS. The phone app keeps wry's app-delegate window; this
// scene is declared CarPlay-only in Info.plist. The Now Playing screen and its
// transport controls are system-driven from MPNowPlayingInfoCenter /
// MPRemoteCommandCenter (already populated by the WebView navigator.mediaSession
// during TTS), so this delegate only owns the root list entry point.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private var interfaceController: CPInterfaceController?

  private static let stateChanged = Notification.Name("readestCarPlayStateChanged")

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    interfaceController.setRootTemplate(makeRootTemplate(), animated: false, completion: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(onStateChanged), name: Self.stateChanged, object: nil)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    NotificationCenter.default.removeObserver(self, name: Self.stateChanged, object: nil)
    self.interfaceController = nil
  }

  @objc private func onStateChanged() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, let controller = self.interfaceController else { return }
      controller.setRootTemplate(self.makeRootTemplate(), animated: false, completion: nil)
    }
  }

  private func makeRootTemplate() -> CPListTemplate {
    let defaults = UserDefaults.standard
    let active = defaults.bool(forKey: "readest.carplay.active")

    let item: CPListItem
    if active {
      let title = defaults.string(forKey: "readest.carplay.title") ?? "Now Reading"
      let author = defaults.string(forKey: "readest.carplay.author") ?? ""
      item = CPListItem(text: title, detailText: author.isEmpty ? nil : author)
      if let artwork = MPNowPlayingInfoCenter.default().nowPlayingInfo?[
        MPMediaItemPropertyArtwork] as? MPMediaItemArtwork {
        item.setImage(artwork.image(at: CGSize(width: 88, height: 88)))
      }
      item.handler = { [weak self] _, completion in
        self?.interfaceController?.pushTemplate(
          CPNowPlayingTemplate.shared, animated: true, completion: nil)
        completion()
      }
    } else {
      item = CPListItem(text: "Open a book on your phone to start", detailText: nil)
      item.isEnabled = false
    }

    let section = CPListSection(items: [item])
    return CPListTemplate(title: "Readest", sections: [section])
  }
}
