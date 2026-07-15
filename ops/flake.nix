{
  description = "Readest development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    android = {
      url = "github:tadfisher/android-nixpkgs/stable";
    };
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, android, fenix }:
    {
      overlay = final: prev: {
        inherit (self.packages.${final.stdenv.hostPlatform.system}) android-sdk;
      };
    }
    //
    flake-utils.lib.eachDefaultSystem (system:
      let
        inherit (nixpkgs) lib;
        inherit (pkgs.lib) optionals;
        inherit (pkgs.lib) optionalAttrs;
        inherit (pkgs.stdenv) isDarwin;

        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          overlays = [
            fenix.overlays.default
            self.overlay
          ];
        };

        commonPackages = with pkgs; [
          pnpm
          nodejs_24
          clang
          pkg-config
          pkgs.rust-analyzer-nightly
          xdg-utils
          self.formatter.${pkgs.stdenv.hostPlatform.system}
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

        # zlib stores zlib.pc in share/pkgconfig while everything else is stored in lib/pkgconfig
        pkgConfigPath = lib.concatStringsSep ":" [
          (lib.makeSearchPath "lib/pkgconfig" (map getDev systemDeps))
          (lib.makeSearchPath "share/pkgconfig" (map getDev systemDeps))
        ];

        xdgPath = "${
          lib.makeSearchPath "share/gsettings-schemas" [
            pkgs.gsettings-desktop-schemas
            pkgs.gtk3
          ]
        }:$XDG_DATA_DIRS";

        libPath = lib.makeLibraryPath (map getLib systemDeps);

        mkCommonShell =
          { name
          , postInit ? ""
          , extraPackages ? [ ]
          , extraTargets ? [ ]
          , extraEnv ? { }
          }:
          pkgs.mkShell {
            inherit name;
            packages =
              commonPackages
              ++ extraPackages
              ++ [
                (
                  with pkgs.fenix;
                  pkgs.fenix.combine [
                    complete.cargo
                    complete.clippy
                    complete.rust-src
                    complete.rustc
                    complete.rustfmt
                    extraTargets
                  ]
                )
              ];
            env = {
              PKG_CONFIG_PATH = pkgConfigPath;
              RUSTFLAGS = "-C link-arg=-Wl,-rpath,${libPath}";
              LIBRARY_PATH = libPath;
              XDG_DATA_DIRS = xdgPath;
              GDK_BACKEND = "x11";
            } // (optionalAttrs isDarwin {
              RUSTFLAGS = ''"-L framework=$DEVSHELL_DIR/Library/Frameworks"'';
              RUSTDOCFLAGS = ''"-L framework=$DEVSHELL_DIR/Library/Frameworks"'';
              PATH = "${lib.makeBinPath [
                  pkgs.xcbuild
                  "${pkgs.xcbuild}/Toolchains/XcodeDefault.xctoolchain"
                ]}:$PATH";
            }) // extraEnv;
            shellHook = ''
              git submodule update --init --recursive
              pnpm install
              pnpm --filter @readest/readest-app setup-vendors

              ${postInit}
            '';
          };
      in
      {
        packages = {
          android-sdk = android.sdk.${pkgs.stdenv.hostPlatform.system} (sdkPkgs: with sdkPkgs; [
            # Useful packages for building and testing.
            build-tools-36-0-0
            build-tools-35-0-0
            build-tools-34-0-0
            cmdline-tools-latest
            emulator
            platform-tools
            platforms-android-36
            platforms-android-35
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
        };

        devShells = {
          web = mkCommonShell {
            name = "readest-dev";
          };

          ios = mkCommonShell {
            name = "readest-ios";
            extraPackages = [ pkgs.cocoapods ];
          };

          android = mkCommonShell rec {
            name = "readest-android";
            postInit = ''
              rm -rf apps/readest-app/src-tauri/gen/android
              pnpm tauri android init
              git checkout apps/readest-app/src-tauri/gen/android
              pnpm tauri icon ../../data/icons/readest-book.png

              if [ ! -d "$ANDROID_AVD_HOME/${name}.avd" ]; then
                  avdmanager create avd \
                    -n ${name} \
                    -k "system-images;android-34;google_apis;x86_64" \
                    -d "pixel" \
                    --force
                fi
            '';
            extraTargets = with pkgs.fenix.targets; [
              aarch64-linux-android.latest.rust-std
              armv7-linux-androideabi.latest.rust-std
              i686-linux-android.latest.rust-std
              x86_64-linux-android.latest.rust-std
            ];
            extraPackages = [
              pkgs.android-sdk
              pkgs.gradle
              pkgs.jdk
            ];
            extraEnv = {
              ANDROID_HOME = "${pkgs.android-sdk}/share/android-sdk";
              ANDROID_SDK_ROOT = "${pkgs.android-sdk}/share/android-sdk";
              NDK_HOME = "${pkgs.android-sdk}/share/android-sdk/ndk/26.1.10909125";
              JAVA_HOME = pkgs.jdk.home;
              ANDROID_AVD_HOME = "$XDG_CONFIG_HOME/.android/avd";
            };
          };

          default = self.devShells.${pkgs.stdenv.hostPlatform.system}.web;
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
