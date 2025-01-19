{
  description = "Readest development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    devshell.url = "github:numtide/devshell";
    android = {
      url = "github:tadfisher/android-nixpkgs/stable";
    };
  };

  outputs = { self, nixpkgs, flake-utils, android, devshell }:
    {
      overlay = final: prev: {
        inherit (self.packages.${final.system}) android-sdk android-studio;
      };
    }
    //
    flake-utils.lib.eachDefaultSystem (system:
      let
        inherit (nixpkgs) lib;
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          overlays = [
            devshell.overlays.default
            self.overlay
          ];
        };
        # android-studio is not available in aarch64-darwin
        androidConditionalPackages = if pkgs.system != "aarch64-darwin" then [ pkgs.android-studio ] else [ ];
        commonPackages = with pkgs; [
          pnpm
        ];
        mkCommonSHell = { name, extraPackages ? [], extraEnv ? [] }:
          pkgs.devshell.mkShell {
            inherit name;
            packages = commonPackages ++ extraPackages;
            env = extraEnv;
          };

      in {
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
            web = mkCommonSHell {
              name = "readest-dev";
            };

            ios = mkCommonSHell {
              name = "readest-ios";
              extraPackages = [ pkgs.cocoapods ];
            };

            android = mkCommonSHell {
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
