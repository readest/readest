import CarPlay
import MediaPlayer
import UIKit

private struct CarPlayBook: Decodable {
  let hash: String
  let title: String
  let author: String
  let isAudiobook: Bool
}

// The native TTS plugin publishes the recent library and owns Now Playing /
// remote commands. Book selections use the same autoplay links as Android Auto.
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
  private var interfaceController: CPInterfaceController?
  private var rootTemplate: CPListTemplate?

  private static let stateChanged = Notification.Name("readestCarPlayStateChanged")

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didConnect interfaceController: CPInterfaceController
  ) {
    self.interfaceController = interfaceController
    let root = CPListTemplate(title: "Readest", sections: makeSections())
    rootTemplate = root
    interfaceController.setRootTemplate(root, animated: false, completion: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(onStateChanged), name: Self.stateChanged, object: nil)
  }

  func templateApplicationScene(
    _ templateApplicationScene: CPTemplateApplicationScene,
    didDisconnectInterfaceController interfaceController: CPInterfaceController
  ) {
    NotificationCenter.default.removeObserver(self, name: Self.stateChanged, object: nil)
    self.interfaceController = nil
    rootTemplate = nil
  }

  @objc private func onStateChanged() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      // Updating the list must not pop a Now Playing screen the user opened.
      self.rootTemplate?.updateSections(self.makeSections())
    }
  }

  private func showNowPlaying() {
    guard let controller = interfaceController,
      !(controller.topTemplate is CPNowPlayingTemplate) else { return }
    controller.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
  }

  private func makeSections() -> [CPListSection] {
    let defaults = UserDefaults.standard
    let active = defaults.bool(forKey: "readest.carplay.active")

    var sections: [CPListSection] = []
    if active {
      let title = defaults.string(forKey: "readest.carplay.title") ?? "Now Reading"
      let author = defaults.string(forKey: "readest.carplay.author") ?? ""
      let item = CPListItem(text: title, detailText: author.isEmpty ? nil : author)
      if let artwork = MPNowPlayingInfoCenter.default().nowPlayingInfo?[
        MPMediaItemPropertyArtwork] as? MPMediaItemArtwork {
        item.setImage(artwork.image(at: CGSize(width: 88, height: 88)))
      }
      item.handler = { [weak self] _, completion in
        self?.showNowPlaying()
        completion()
      }
      sections.append(CPListSection(items: [item], header: "Now Playing", sectionIndexTitle: nil))
    }

    let books = defaults.data(forKey: "readest.carplay.books")
      .flatMap { try? JSONDecoder().decode([CarPlayBook].self, from: $0) } ?? []
    let items = books.prefix(10).map { book in
      let item = CPListItem(text: book.title, detailText: book.author.isEmpty ? nil : book.author)
      item.handler = { [weak self, weak item] _, completion in
        var components = URLComponents()
        components.scheme = "readest"
        components.host = "book"
        components.path = "/\(book.hash)"
        if !book.isAudiobook {
          components.queryItems = [URLQueryItem(name: "autoplay", value: "tts")]
        }
        guard let url = components.url else {
          completion()
          return
        }
        // Deliver directly to Tauri's deep-link handler. Opening the phone app
        // through UIApplication.open is denied during a car-only cold launch.
        // The plugin retains the URL until the WebView and library are ready.
        let application = UIApplication.shared
        if application.delegate?.application?(application, open: url, options: [:]) == true {
          self?.showNowPlaying()
        } else {
          item?.setDetailText("Unable to open book. Open Readest on your phone and try again.")
        }
        completion()
      }
      return item
    }
    if !items.isEmpty {
      sections.append(CPListSection(items: items, header: "Recent Books", sectionIndexTitle: nil))
    } else if !active {
      let item = CPListItem(text: "Open Readest on your phone to load your library", detailText: nil)
      item.isEnabled = false
      sections.append(CPListSection(items: [item]))
    }
    return sections
  }
}
