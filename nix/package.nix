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
, autoAddDriverRunpath
, lib
, moreutils
, jq
, gst_all_1
, fetchurl
, runCommand
  # Runtime dependencies of the CEF distribution (libcef.so and the ANGLE
  # libraries), resolved by autoPatchelfHook.
, nss
, nspr
, at-spi2-core
, dbus
, cups
, expat
, alsa-lib
, libgbm
, libxkbcommon
, udev
, libx11
, libxcomposite
, libxdamage
, libxext
, libxfixes
, libxrandr
, libxcb
, libxcursor
, libxi
,
}:
rustPlatform.buildRustPackage (finalAttrs: {
  inherit version;
  pname = "readest";
  src =
    let
      tree = lib.fileset.toSource {
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
            ../Cargo.cef.lock
          ]);
      };
    in
    # Linux builds on the CEF runtime, like `pnpm tauri build` on Linux
    # (apps/readest-app/scripts/tauri.mjs): the CEF dependency graph is pinned
    # in Cargo.cef.lock, and src-tauri/.cargo/cef.toml holds the Linux-only
    # `[patch.crates-io]` that takes tauri and its plugins from the feat/cef
    # branches. Cargo only reads a file named config.toml, so both are put in
    # place here, where cargoDeps (fetchCargoVendor) and the build see them.
    runCommand "readest-source" { } ''
      cp -r ${tree} $out
      chmod -R u+w $out
      cp $out/Cargo.cef.lock $out/Cargo.lock
      cp $out/apps/readest-app/src-tauri/.cargo/cef.toml \
        $out/apps/readest-app/src-tauri/.cargo/config.toml
    '';

  # The CEF binary distribution the `cef` crate would otherwise download at
  # build time. Its version has to match cef-dll-sys in Cargo.cef.lock.
  cefDist = {
    x86_64-linux = fetchurl {
      url = "https://cef-builds.spotifycdn.com/cef_binary_151.3.24%2Bg2384915%2Bchromium-151.0.7922.174_linux64_minimal.tar.bz2";
      hash = "sha256-21PEP9rOi37krw8AUSARbWlzqp2Ot3AsBhe635voaE4=";
      passthru = {
        archiveName = "cef_binary_151.3.24+g2384915+chromium-151.0.7922.174_linux64_minimal.tar.bz2";
        sha1 = "b1e99d3e3ff4213f99f7cda0211db89454398811";
      };
    };
    aarch64-linux = fetchurl {
      url = "https://cef-builds.spotifycdn.com/cef_binary_151.3.24%2Bg2384915%2Bchromium-151.0.7922.174_linuxarm64_minimal.tar.bz2";
      hash = "sha256-R5ZbnDallYvdbW/bP+M2DzjRfWWRTvY2q63hSIHNxZs=";
      passthru = {
        archiveName = "cef_binary_151.3.24+g2384915+chromium-151.0.7922.174_linuxarm64_minimal.tar.bz2";
        sha1 = "95acd2a46975e2c60afa6b427ec50c0a3be6236f";
      };
    };
  }.${stdenv.hostPlatform.system} or null;
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
    hash = "sha256-E6z6mXT4fO5TueLiJ03xHTM0CN3u+zXiSfdioi8R85Q=";
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
  cargoHash = "sha256-JxKp18/+AyXKw7tJBJKYoRNroj+nbZKfo33O6ZZr15s=";

  buildAndTestSubdir = "src-tauri";

  # The CEF runtime instead of wry (see src-tauri/Cargo.toml).
  buildFeatures = [ "cef" ];
  buildNoDefaultFeatures = true;
  # The test binaries link libcef.so, which the build sandbox cannot load; the
  # Rust unit tests run in the pull-request workflow (`pnpm test:rust`).
  doCheck = false;

  # winit's X11 backend dlopens Xlib, Xcursor, Xi, Xrandr and xkbcommon at run
  # time (x11-dl, xkbcommon-dl), which autoPatchelf cannot see; put them on
  # the RUNPATH so dlopen finds them.
  runtimeDependencies = [
    libx11
    libxcursor
    libxi
    libxrandr
    libxkbcommon
  ];

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
    # Chromium's GPU process dlopens the system GL/Vulkan drivers; on NixOS
    # they live in /run/opengl-driver/lib, which this adds to the RUNPATHs.
    autoAddDriverRunpath
    moreutils
    jq
  ];

  buildInputs = [
    webkitgtk_4_1
    gtk3
    librsvg
    openssl
    glib-networking
    # libcef.so
    nss
    nspr
    at-spi2-core
    dbus
    cups
    expat
    alsa-lib
    libgbm
    libxkbcommon
    udev
    libx11
    libxcomposite
    libxdamage
    libxext
    libxfixes
    libxrandr
    libxcb
    # TTS
    gst_all_1.gstreamer
    gst_all_1.gst-plugins-base
    gst_all_1.gst-plugins-good
    gst_all_1.gst-plugins-bad
  ];

  preBuild = lib.optionalString stdenv.hostPlatform.isLinux ''
    # Lay the CEF distribution out the way download-cef caches it (Release/
    # and Resources/ flattened, plus archive.json) and point cef-dll-sys at
    # it so it links against it instead of downloading.
    export CEF_PATH="$NIX_BUILD_TOP/cef"
    mkdir -p "$CEF_PATH"
    tar -xjf ${finalAttrs.cefDist} --strip-components=1 -C "$CEF_PATH"
    mv "$CEF_PATH"/Release/* "$CEF_PATH"/Resources/* "$CEF_PATH"/
    printf '{"type": "minimal", "name": "%s", "sha1": "%s"}\n' \
      "${finalAttrs.cefDist.archiveName}" "${finalAttrs.cefDist.sha1}" > "$CEF_PATH/archive.json"
  '' + ''
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

  # The deb the nixpkgs tauri CLI bundles carries only the executable; ship
  # the CEF runtime next to it the way the CEF tauri CLI does for the deb
  # (usr/share/Readest), since libcef.so is found through $ORIGIN.
  postInstall = ''
    # Several plugins still enable tauri's default `wry` feature, so the wry
    # runtime is compiled in even though nothing uses it under CEF. Distro
    # toolchains link with --as-needed and drop the unreferenced WebKitGTK
    # libraries; rustc links through its bundled lld here, so the wrapper's
    # flags never apply and they stay NEEDED. That is fatal: Nix's WebKitGTK
    # uses bmalloc, whose static initializer starts a scavenger thread in every
    # process, and Chromium's zygote refuses to run multi-threaded. Drop them,
    # after checking that nothing in the executable refers to them.
    if $NM -D --undefined-only $out/bin/readest | grep -Eq ' (webkit_|jsc_|JS[A-Z]|soup_)'; then
      echo "readest references WebKitGTK/libsoup symbols; cannot drop the libraries" >&2
      exit 1
    fi
    patchelf --remove-needed libwebkit2gtk-4.1.so.0 --remove-needed libjavascriptcoregtk-4.1.so.0 \
      --remove-needed libsoup-3.0.so.0 $out/bin/readest
    mkdir -p $out/lib/readest
    mv $out/bin/readest $out/lib/readest/readest
    ln -s ../lib/readest/readest $out/bin/readest
    for file in libcef.so libEGL.so libGLESv2.so libvk_swiftshader.so libvulkan.so.1 \
      vk_swiftshader_icd.json chrome_100_percent.pak chrome_200_percent.pak \
      resources.pak icudtl.dat v8_context_snapshot.bin; do
      cp "$CEF_PATH/$file" $out/lib/readest/
    done
    cp -r "$CEF_PATH/locales" $out/lib/readest/
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
