import SwiftRs
import Tauri
import UIKit
import WebKit

class PingArgs: Decodable {
  let value: String?
}

class NativeTTSPlugin: Plugin {
  @objc public func ping(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PingArgs.self)
    invoke.resolve(["value": args.value ?? ""])
  }
}

@_cdecl("init_plugin_native_tts")
func initPlugin() -> Plugin {
  return NativeTTSPlugin()
}
