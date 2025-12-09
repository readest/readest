{
  description = "Readest development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    devshell.url = "github:numtide/devshell";
    android = {
      url = "github:tadfisher/android-nixpkgs/stable";
    };
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, android, devshell, fenix }:
    {
      overlay = final: prev: {
        inherit (self.packages.${final.system}) android-sdk android-studio;
      };
    }
    //
    flake-utils.lib.eachDefaultSystem (system:
      let
        inherit (nixpkgs) lib;
        inherit (pkgs.lib) optionals;
        inherit (pkgs.stdenv) isDarwin;

        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          overlays = [
            devshell.overlays.default
            fenix.overlays.default
            self.overlay
          ];
        };
        # android-studio is not available in aarch64-darwin
        androidConditionalPackages = if pkgs.system != "aarch64-darwin" then [ pkgs.android-studio ] else [ ];
        commonPackages = with pkgs; [
          pnpm
          nodejs_22
          clang
          pkg-config
          (pkgs.fenix.complete.withComponents [
            "cargo"
            "clippy"
            "rust-src"
            "rustc"
            "rustfmt"
          ])
          pkgs.rust-analyzer-nightly
          xdg-utils
        ];

        systemDeps = with pkgs; [
          at-spi2-atk
          atkmm
          cairo
          fontconfig
          fontconfig.out
          freetype
          gdk-pixbuf
          glib
          gtk3
          gtk4
          harfbuzz
          librsvg
          libsoup_3
          openssl
          pango
          zlib
        ] ++ (optionals (!isDarwin) [
          webkitgtk_4_1
        ]) ++ (optionals isDarwin [
          darwin.libiconv
        ]);
        getDev = pkg: if pkg ? dev then pkg.dev else pkg;
        getLib = pkg: if pkg ? lib then pkg.lib else pkg;

        pkgConfigPath = lib.makeSearchPath "lib/pkgconfig" (map getDev systemDeps);
        libPath = lib.makeLibraryPath (map getLib systemDeps);

        mkCommonShell =
          { name
          , extraPackages ? [ ]
          , extraEnv ? [
              {
                name = "PKG_CONFIG_PATH";
                value = pkgConfigPath;
              }
              {
                name = "RUSTFLAGS";
                value = "-C link-arg=-Wl,-rpath,${libPath}";
              }
              {
                name = "LIBRARY_PATH";
                value = libPath;
              }
            ] ++ (optionals isDarwin [
              {
                name = "RUSTFLAGS";
                eval = "\"-L framework=$DEVSHELL_DIR/Library/Frameworks\"";
              }
              {
                name = "RUSTDOCFLAGS";
                eval = "\"-L framework=$DEVSHELL_DIR/Library/Frameworks\"";
              }
              {
                name = "PATH";
                prefix =
                  let
                    inherit (pkgs) xcbuild;
                  in
                  lib.makeBinPath [
                    xcbuild
                    "${xcbuild}/Toolchains/XcodeDefault.xctoolchain"
                  ];
              }
            ])
          }:
          pkgs.devshell.mkShell {
            inherit name;
            packages = commonPackages ++ extraPackages;
            env = extraEnv;
          };
      in
      {
        packages = {
          android-sdk = android.sdk.${system} (sdkPkgs: with sdkPkgs; [
            # Useful packages for building and testing.
            build-tools-34-0-0
            cmdline-tools-latest
            emulator
            platform-tools
            platforms-android-34
            ndk-26-1-10909125
          ]
          ++ lib.optionals (system == "aarch64-darwin") [
            system-images-android-34-google-apis-arm64-v8a
            system-images-android-34-google-apis-playstore-arm64-v8a
          ]
          ++ lib.optionals (system == "x86_64-darwin" || system == "x86_64-linux") [
            system-images-android-34-google-apis-x86-64
            system-images-android-34-google-apis-playstore-x86-64
          ]);
        } // lib.optionalAttrs (system == "x86_64-linux") {
          # Android Studio in nixpkgs is currently packaged for x86_64-linux only.
          android-studio = pkgs.androidStudioPackages.stable;
        };

        devShells = {
          web = mkCommonShell {
            name = "readest-dev";
          };

          ios = mkCommonShell {
            name = "readest-ios";
            extraPackages = [ pkgs.cocoapods ];
          };

          android = mkCommonShell {
            name = "readest-android";
            extraPackages = [
              pkgs.android-sdk
              pkgs.gradle
              pkgs.jdk
            ] ++ androidConditionalPackages;
            extraEnv = [
              {
                name = "ANDROID_HOME";
                value = "${pkgs.android-sdk}/share/android-sdk";
              }
              {
                name = "ANDROID_SDK_ROOT";
                value = "${pkgs.android-sdk}/share/android-sdk";
              }
              {
                name = "NDK_HOME";
                value = "${pkgs.android-sdk}/share/android-sdk/ndk/26.1.10909125";
              }
              {
                name = "JAVA_HOME";
                value = pkgs.jdk.home;
              }
            ];
          };

          default = self.devShells.${system}.web;
        };
      });
}
