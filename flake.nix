{
  description = "Readest development environment";

  # Points `nix run`/`nix build` at the project's public Cachix cache so users
  # do not compile the Rust/Tauri stack and webkitgtk from source. Nix ignores
  # this for non-trusted users and otherwise prompts for consent, so the README
  # also documents `cachix use readest` as the permanent opt-in.
  nixConfig = {
    extra-substituters = [ "https://readest.cachix.org" ];
    extra-trusted-public-keys = [
      "readest.cachix.org-1:KvKAePcZZCZB8ytFIAOGdgN3VRdmFHGRMHqMVckbt5c="
    ];
  };

  inputs = {
    self.submodules = true;
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
    flake-utils.lib.eachSystem [
      "x86_64-linux"
      "aarch64-darwin"
    ]
      (system:
        let
          inherit (nixpkgs) lib;
          inherit (pkgs.lib) optionals;
          inherit (pkgs.stdenv) isDarwin;

          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
            overlays = [ fenix.overlays.default ];
          };

          toolchain = with pkgs.fenix.complete; [
            cargo
            clippy
            rust-src
            rustc
            rustfmt
          ];

          commonNativeBuildInupts = with pkgs; [
            pnpm
            nodejs_24
            clang
            rust-analyzer-nightly
            pkg-config
            xdg-utils
            patchelf
            wrapGAppsHook4
            playwright-driver.browsers
            self.formatter.${pkgs.stdenv.hostPlatform.system}
          ];

          commonBuildInputs = with pkgs; [
            at-spi2-atk
            atkmm
            cairo
            fontconfig
            freetype
            gdk-pixbuf
            glib
            gtk3
            harfbuzz
            librsvg
            libsoup_3
            openssl
            pango
            zlib

            gst_all_1.gstreamer
            gst_all_1.gst-plugins-base
            gst_all_1.gst-plugins-good
            gst_all_1.gst-plugins-bad
          ] ++ (optionals (!isDarwin) [
            webkitgtk_4_1
          ]) ++ (optionals isDarwin [
            darwin.libiconv
          ]);

          mkCommonShell =
            { name
            , postInit ? ""
            , extraNativeBuildInputs ? [ ]
            , extraTargets ? [ ]
            , extraEnv ? { }
            }:
            pkgs.mkShell rec {
              inherit name;

              nativeBuildInputs = commonNativeBuildInupts ++ extraNativeBuildInputs;
              buildInputs = commonBuildInputs ++ [
                (
                  with pkgs.fenix;
                  combine [
                    toolchain
                    extraTargets
                  ]
                )
              ];

              env = {
                GDK_BACKEND = "x11";
                LD_LIBRARY_PATH = lib.makeLibraryPath buildInputs;

                PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
                PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = 1;
                PLAYWRIGHT_HOST_PLATFORM_OVERRIDE = "ubuntu-24.04";
              } // extraEnv;

              shellHook = ''
                git submodule update --init --recursive
                pnpm install

                ${postInit}
              '';
            };
        in
        {
          packages = {
            android-sdk = android.sdk.${system} (sdkPkgs: with sdkPkgs; [
              build-tools-36-0-0
              build-tools-35-0-0
              build-tools-34-0-0
              cmdline-tools-latest
              emulator
              platform-tools
              platforms-android-36
              platforms-android-35
              platforms-android-34
            ]
            ++ lib.optionals (system == "aarch64-darwin") [
              system-images-android-34-google-apis-arm64-v8a
              system-images-android-34-google-apis-playstore-arm64-v8a
            ]
            ++ lib.optionals (system == "x86_64-linux") [
              system-images-android-34-google-apis-x86-64
              system-images-android-34-google-apis-playstore-x86-64
            ]);
          } // lib.optionalAttrs (!isDarwin) {
            default = pkgs.callPackage ./nix/package.nix { };
          };

          devShells = {
            default = mkCommonShell {
              name = "readest-dev";
            };

            android =
              let
                android-sdk = self.packages.${system}.android-sdk;
              in
              mkCommonShell
                rec {
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
                  extraNativeBuildInputs = [
                    android-sdk
                    pkgs.gradle
                    pkgs.jdk
                  ];
                  extraEnv = {
                    ANDROID_HOME = "${android-sdk}/share/android-sdk";
                    ANDROID_SDK_ROOT = "${android-sdk}/share/android-sdk";
                    NDK_HOME = "${android-sdk}/share/android-sdk/ndk/26.1.10909125";
                    JAVA_HOME = pkgs.jdk.home;
                    ANDROID_AVD_HOME = "$XDG_CONFIG_HOME/.android/avd";
                  };
                };
          } // lib.optionalAttrs isDarwin {
            ios = mkCommonShell {
              name = "readest-ios";
              extraNativeBuildInputs = [ pkgs.cocoapods ];
            };
          };

          formatter = pkgs.nixpkgs-fmt;

          # Deliberately no `checks.build`. `nix flake check` builds everything
          # in `checks`, so pointing it at packages.default turned the PR check
          # into a full release build: cargo vendor, a production Next.js build,
          # and a cold release compile of the whole Tauri tree, with no sccache
          # or rust-cache available inside the nix sandbox. That ran ~45 min per
          # PR. The flake outputs are still evaluated across systems here, which
          # catches eval errors, and `nix build` in nix-build.yml does the real
          # build on main and pushes the result to the binary cache.
          checks = { };
        });

}
