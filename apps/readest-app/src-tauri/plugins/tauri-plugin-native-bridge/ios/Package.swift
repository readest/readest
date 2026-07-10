// swift-tools-version:5.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
  name: "tauri-plugin-native-bridge",
  platforms: [
    .macOS(.v10_13),
    // Matches the app's IPHONEOS_DEPLOYMENT_TARGET (15.0); StoreKit's
    // Storefront is used unguarded and needs iOS 15. SPM takes the
    // deployment floor from this stanza, not from the build triple.
    // (String form: `.v15` needs swift-tools 5.5, this manifest is 5.3.)
    .iOS("15.0"),
  ],
  products: [
    // Products define the executables and libraries a package produces, and make them visible to other packages.
    .library(
      name: "tauri-plugin-native-bridge",
      type: .static,
      targets: ["tauri-plugin-native-bridge"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    // Targets are the basic building blocks of a package. A target can define a module or a test suite.
    // Targets can depend on other targets in this package, and on products in packages this package depends on.
    .target(
      name: "tauri-plugin-native-bridge",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
