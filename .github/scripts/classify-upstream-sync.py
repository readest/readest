#!/usr/bin/env python3
import subprocess
import sys

SENSITIVE_PREFIXES = (
    ".github/",
    "scripts/",
    "nix/",
    "patches/",
    "apps/readest-app/scripts/",
    "apps/readest-app/src-tauri/capabilities/",
    "apps/readest-app/src-tauri/capabilities-extra/",
    "apps/readest-app/src-tauri/.cargo/",
    "apps/readest-app/src-tauri/gen/android/",
    "apps/readest-app/src-tauri/plugins/tauri-plugin-native-bridge/permissions/",
    "apps/readest.koplugin/native/",
    "apps/readest.koplugin/scripts/",
    "packages/",
)
# Only these well-understood source and documentation trees are eligible for
# automatic merge. New paths and build/config files outside them fail closed.
AUTOMATIC_PREFIXES = (
    "apps/readest-app/src/",
    "apps/readest-app/src-tauri/src/",
    "apps/readest-app/src-tauri/plugins/",
    "apps/readest-app/public/locales/",
    "apps/readest-app/extensions/",
    "apps/readest.koplugin/",
    "apps/readest-crosspoint-plugin/",
    "docs/",
)
SENSITIVE_EXACT = {
    "README.md",
    "apps/readest-app/next.config.ts",
    ".gitmodules",
    "Cargo.toml",
    "Cargo.lock",
    "Cargo.cef.lock",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    "flake.nix",
    "flake.lock",
    "Dockerfile",
    "apps/readest-app/package.json",
    "apps/readest-app/src/config/appConfig.ts",
    "apps/readest-app/src-tauri/tauri.conf.json",
    "apps/readest-app/src-tauri/tauri.android.conf.json",
    "apps/readest-app/release-notes.json",
}
SENSITIVE_SUFFIXES = (
    ".lock",
    ".entitlements",
    ".mobileprovision",
    ".plist",
    ".gradle",
    ".gradle.kts",
)


def requires_review(path):
    filename = path.rsplit("/", 1)[-1]
    return (
        path.startswith(SENSITIVE_PREFIXES)
        or path in SENSITIVE_EXACT
        or path.endswith(SENSITIVE_SUFFIXES)
        or filename in {
            "Cargo.toml",
            "package.json",
            "build.rs",
            "build.gradle",
            "build.gradle.kts",
            "AndroidManifest.xml",
            "Dockerfile",
            "Makefile",
            "Justfile",
            ".npmrc",
            ".nvmrc",
        }
        or filename.endswith((".config.js", ".config.cjs", ".config.mjs", ".config.ts", ".config.cts", ".config.mts"))
        or filename.startswith("tauri.") and filename.endswith(".conf.json")
        or path.endswith((".yml", ".yaml"))
        and (path.startswith(".github/") or path.startswith(".buildkite/"))
    )


def classify(base, head):
    result = subprocess.run(
        ["git", "diff", "--name-only", "-z", f"{base}...{head}"],
        check=True,
        stdout=subprocess.PIPE,
    )
    paths = [p.decode("utf-8", errors="strict") for p in result.stdout.split(b"\0") if p]
    sensitive = [
        path for path in paths if requires_review(path) or not path.startswith(AUTOMATIC_PREFIXES)
    ]
    return paths, sensitive


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: classify-upstream-sync.py BASE HEAD")
    changed, sensitive = classify(sys.argv[1], sys.argv[2])
    print("sensitive" if sensitive else "automatic")
    for path in sensitive:
        print(path)
