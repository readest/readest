import AuthenticationServices
import SwiftRs
import Tauri
import UIKit
import WebKit

class RequestArgs: Decodable {
  let authUrl: String
}

struct Response: Encodable {
  let redirectUrl: String
}

class SafariAuthPlugin: Plugin {
  private var authSession: ASWebAuthenticationSession?

  @objc public func auth_with_safari(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(RequestArgs.self)
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
}

@_cdecl("init_plugin_safari_auth")
func initPlugin() -> Plugin {
  return SafariAuthPlugin()
}

@available(iOS 13.0, *)
extension SafariAuthPlugin: ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return UIApplication.shared.windows.first ?? UIWindow()
  }
}
