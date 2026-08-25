{ stdenv
, version ? "0.0.0-git"
, rustPlatform
, pnpm_11
, fetchPnpmDeps
, pnpmConfigHook
, cargo-tauri
, nodejs
, pkg-config
, webkitgtk_4_1
, wrapGAppsHook3
, gtk3
, librsvg
, openssl
, glib-networking
, autoPatchelfHook
, lib
, moreutils
, jq
, gst_all_1
,
}:
rustPlatform.buildRustPackage (finalAttrs: {
  inherit version;
  pname = "readest";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.intersection
      (lib.fileset.gitTracked ../.)
      (lib.fileset.unions [
        ../apps/readest-app
        ../apps/readest-app/src-tauri/plugins/tauri-plugin-turso
        ../apps/readest-app/src-tauri/plugins/tauri-plugin-webview-upgrade

        ../packages
        ../patches

        ../package.json
        ../pnpm-lock.yaml
        ../pnpm-workspace.yaml

        ../Cargo.toml
        ../Cargo.lock
      ]);
  };
  postUnpack = ''
    # pnpm.configHook has to write to ../.., as our sourceRoot is set to
    # apps/readest-app
    chmod -R +w .
  '';

  sourceRoot = "${finalAttrs.src.name}/apps/readest-app";

  pnpmRoot = "../..";
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_11;
    fetcherVersion = 4;
    # Regenerate whenever pnpm-lock.yaml changes: the nix-deps-check workflow
    # fails on pull requests that change the lockfile and prints the expected
    # hash in its log.
    hash = "sha256-0gMtrfX+s3cOPGrl1cmmAMwvk0jMVezm3j+oJqvlhb8=";
    pnpmInstallFlags = [
      # Increase number of fetch attempts to work around timeout issues on slow
      # networks: "TimeoutError: The operation was aborted due to timeout".
      #
      # If this still happens on your network, consider changing some of the
      # fetch setting and opening a pull request:
      # https://pnpm.io/settings#request-settings
      "--fetch-retries=5"
    ];
  };

  cargoRoot = "../..";
  cargoHash = "sha256-a3KVOqYsO1LQF1D0Maxrq9MsLgjYQFgyU0oemn4Xkn0=";

  buildAndTestSubdir = "src-tauri";

  postPatch = ''
    substituteInPlace src-tauri/tauri.conf.json \
      --replace-fail \
        '"beforeBuildCommand": "pnpm build && pnpm upload-sourcemaps"' \
        '"beforeBuildCommand": "pnpm build"' \
      --replace-fail '"createUpdaterArtifacts": true' '"createUpdaterArtifacts": false' \
      --replace-fail '"productName": "Readest"' '"productName": "readest"'
    jq 'del(.plugins."deep-link")' src-tauri/tauri.conf.json | sponge src-tauri/tauri.conf.json
    substituteInPlace src/services/constants.ts \
      --replace-fail "autoCheckUpdates: true" "autoCheckUpdates: false" \
      --replace-fail "telemetryEnabled: true" "telemetryEnabled: false"

    jq '.version = "${finalAttrs.version}"' package.json | sponge package.json

    mkdir -p src-tauri/plugins/tauri-plugin-turso/dist-js
    cp -r ${finalAttrs.tursoPlugin} src-tauri/plugins/tauri-plugin-turso/dist-js
    jq '.scripts.build = "true"' \
      src-tauri/plugins/tauri-plugin-turso/package.json | \
      sponge src-tauri/plugins/tauri-plugin-turso/package.json
  '';

  nativeBuildInputs = [
    cargo-tauri.hook
    nodejs
    pnpmConfigHook
    pnpm_11
    pkg-config
    wrapGAppsHook3
    autoPatchelfHook
    moreutils
    jq
  ];

  buildInputs = [
    webkitgtk_4_1
    gtk3
    librsvg
    openssl
    glib-networking
    # TTS
    gst_all_1.gstreamer
    gst_all_1.gst-plugins-base
    gst_all_1.gst-plugins-good
    gst_all_1.gst-plugins-bad
  ];

  preBuild = ''
    # set up pdfjs and simplecc
    pnpm setup-vendors

    # `tauri-plugin-turso` expects frontend files to exist before the build, else it fails with:
    #
    # > > tauri-plugin-turso-api@0.1.0 build /build/source/apps/readest-app/src-tauri/plugins/tauri-plugin-turso
    # > > true
    # >
    # >   Error Unable to find your web assets, did you forget to build your web app?
    #     Your frontendDist is set to "../out" (which is `/build/source/apps/readest-app/out`).
    pnpm --filter @readest/readest-app build
  '';

  tursoPluginDeps = fetchPnpmDeps {
    pname = "tauri-plugin-turso";
    version = finalAttrs.version;
    src = "${finalAttrs.src}/apps/readest-app/src-tauri/plugins/tauri-plugin-turso";
    pnpm = pnpm_11;
    fetcherVersion = 4;
    hash = "sha256-quVUYsT3u4UBhuJ75QQ4SEuW8MhGQ0vGhtwtUj/eKHs=";
  };

  tursoPlugin = stdenv.mkDerivation {
    pname = "tauri-plugin-turso";
    version = finalAttrs.version;
    src = "${finalAttrs.src}/apps/readest-app/src-tauri/plugins/tauri-plugin-turso";

    nativeBuildInputs = [
      pnpm_11
      pnpmConfigHook
      nodejs
    ];
    pnpmDeps = finalAttrs.tursoPluginDeps;
    buildPhase = ''
      pnpm build
    '';
    installPhase = ''
      cp -r dist-js $out
    '';
  };

  meta = {
    description = "Modern, feature-rich ebook reader";
    homepage = "https://github.com/readest/readest";
    mainProgram = "readest";
    license = lib.licenses.agpl3Plus;
    platforms = lib.platforms.linux;
  };
})
