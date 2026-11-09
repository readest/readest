---
name: release-flathub
description: >-
  Update the Flathub manifest (com.bilingify.readest.yml) plus the generated
  cargo-sources.json / node-sources.json for a new release. The Flatpak is built
  from source (see flathub/com.bilingify.readest#31), so every release must
  regenerate the offline dependency source lists. Use when asked to "release on
  flathub", "update flathub", or "flathub release for version X".
  Takes a version number as argument (e.g., /release-flathub 0.12.6).
---

## Flathub Release Updater

Update `/Users/chrox/dev/com.bilingify.readest/` for a new release.

Since flathub/com.bilingify.readest#31 the Flatpak is **built from source**, not
repacked from the GitHub `.deb` artifacts. A release bump therefore touches three
files: the manifest, `cargo-sources.json`, and `node-sources.json`.

### Inputs

- **Version**: Provided as `$ARGUMENTS`. If empty, read the version from `package.json` in the readest-app directory.
- **Flathub repo**: `/Users/chrox/dev/com.bilingify.readest/`
- **Readest repo**: `/Users/chrox/dev/readest/`

### Steps

1. **Determine version and tag**
   - Use `$ARGUMENTS` if provided, otherwise read from `package.json`
   - Set `TAG=v{version}` (e.g., `v0.12.6`)
   - `cd /Users/chrox/dev/readest && git fetch origin --tags` (the `v0.8.9` tag
     rejection is expected and harmless), then
     `git rev-parse {TAG}` to get the commit SHA. Verify the tag exists — never
     guess the SHA.

2. **Start from a clean flathub branch**
   ```bash
   cd /Users/chrox/dev/com.bilingify.readest
   git fetch origin --prune
   git checkout master && git reset --hard origin/master
   git checkout -b release-{TAG}
   ```

3. **Extract the lockfiles from the tag** (do not use the working tree — it may
   be ahead of the tag):
   ```bash
   git -C /Users/chrox/dev/readest show {TAG}:pnpm-lock.yaml > $SCRATCH/src/pnpm-lock.yaml
   git -C /Users/chrox/dev/readest show {TAG}:Cargo.cef.lock > $SCRATCH/src/Cargo.cef.lock
   ```
   The Flatpak builds the CEF runtime, so its crates come from `Cargo.cef.lock`,
   not `Cargo.lock`. The wrong lockfile silently drops git sources.

4. **Set up the generators** (not installed on this machine; clone + venv each time):
   ```bash
   git clone --depth 1 https://github.com/flatpak/flatpak-builder-tools.git
   python3 -m venv venv
   ./venv/bin/pip install "aiohttp>=3.9.5,<4" "PyYAML>=6.0.2,<7" "tomlkit>=0.13.3,<1.0"
   ```

5. **Regenerate the source lists** (both need network; the shell already exports
   `http_proxy`/`https_proxy`):
   ```bash
   cd $SCRATCH/src
   ./venv/bin/python flatpak-builder-tools/cargo/flatpak-cargo-generator.py \
       -o cargo-sources.json Cargo.cef.lock
   PYTHONPATH=flatpak-builder-tools/node ./venv/bin/python -m flatpak_node_generator \
       -o node-sources.json --pnpm-store-version v11 --no-playwright-browsers \
       pnpm pnpm-lock.yaml
   ```
   - `--no-playwright-browsers` is required: the manifest sets
     `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` and does not vendor those browsers.
     Without the flag the list gains five Playwright browser archives.
   - Invoke the node generator as `-m flatpak_node_generator` (the package
     `__main__`). `-m flatpak_node_generator.main` exits silently doing nothing.
   - The node generator writes ~500KB of progress to stderr; pipe through
     `tail` or redirect to a file.
   - The cargo run clones each git dependency. `readest/localsend` registers a
     `flutter` submodule with `update = none`; git and flatpak-builder both skip
     it, so no `disable-submodules` is needed.

6. **Update the manifest**
   - Bump only the readest `type: git` source's `commit` to the SHA from step 1.
     That source has no `tag` field.
   - Check `packageManager` in the tag's `package.json` against the pinned
     `pnpm-*.tgz` archive source; if pnpm changed, update the URL and its
     `sha256` (and `--pnpm-store-version` if the major changed).
   - Do NOT modify build-commands, finish-args, runtime, etc.
   - Leave sdk-extensions and build-options alone unless a new dependency needs
     a tool the SDK lacks. Example: `soundtouch-ffi` runs bindgen, which needs
     libclang, so v0.12.20 added the `llvm21` extension, its bin and lib paths,
     and `LIBCLANG_PATH`. Pick an extension with a branch matching the runtime's
     freedesktop base, and say why in the PR description.

7. **Verify before committing**
   - Both JSON files parse, and their entry "shapes" (sets of keys) match the
     previous revision's — a new shape means the generator changed behaviour or
     the lockfile gained a git dependency; explain it rather than shipping blind.
   - Spot-check at least one npm `sha512` and one crate `sha256` by downloading
     the artifact and hashing it.
   - Confirm `data/metainfo/appdata.xml` at `{TAG}` contains a
     `<release version="{version}">` entry — the build installs it and Flathub
     validates it.
   - Confirm `.gitmodules` submodule URLs at `{TAG}` are all reachable;
     flatpak-builder clones them and a private/moved one breaks the build.
   - Print a summary: old version → new version, old commit → new commit.

8. **Commit, push, and open the PR**
   - Commit all three files with message `release: version {TAG}` — no
     Co-Authored-By lines.
   - Push needs the SOCKS proxy SSH config:
     `GIT_SSH_COMMAND='ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=10' git push --no-verify -u origin release-{TAG}`
   - `gh pr create --repo flathub/com.bilingify.readest --base master --title "release: version {TAG}" --body "..."`
   - Print the PR URL, then check `gh pr checks {N} --repo flathub/com.bilingify.readest`
     — the `builds/x86_64` and `builds/aarch64` bots build the Flatpak from
     source and are the only real validation of the regenerated source lists.

### Important Notes

- The old `.deb`-repacking flow (three `type: file` sources with hand-computed
  sha256s) is **gone**. If the manifest still looks like that, the checkout is
  stale — re-fetch `origin/master`.
- Never hand-edit `cargo-sources.json` / `node-sources.json`; always regenerate.
- Do NOT add Co-Authored-By lines in commit messages.
