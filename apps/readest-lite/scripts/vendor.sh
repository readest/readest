#!/bin/sh
# Builds vendor/ (gitignored): the upstream code Readest Lite patches, fetched at pinned versions,
# with patches/<tree>.diff applied. Only the patches are committed.
#   scripts/vendor.sh          fetch upstream, apply the patches -> vendor/
#   scripts/vendor.sh diff     after editing vendor/: rewrite patches/*.diff against upstream
# Upstream (patches/README.md says what each patch changes):
#   blitz          DioxusLabs/blitz f9d0e8c76 (0.3.0-beta.4): the 6 packages tauri-runtime-blitz uses
#   tauri          readest/tauri d6ef6e4c7 (feat/cef): the 7 crates Lite builds (no tests/changelog)
#   stylo          servo/stylo 2dca34592 (0.23.0, Blitz's pin): its 11 crates
#   muda           crates.io 0.19.3
#   rquickjs-core  crates.io 0.10.0
#   rquickjs-sys   crates.io 0.10.0, its QuickJS replaced by QuickJS-NG v0.18.0's sources
#   web-streams-polyfill  npm 3.3.3, dist/polyfill.es2018.min.js (unpatched; embedded by the runtime)
set -e
cd "$(dirname "$0")/.."
BLITZ_REV=f9d0e8c76a5fd9ca10d426ac2c065a4f2ecaecb3
TAURI_REV=d6ef6e4c755228713e7358a27794a89cfd30969f
STYLO_REV=2dca34592ced37c6aa01733e94206a767194cf9d
QUICKJS_REV=d7215b0ad3fc2c562e8317fd9bca058fd4863804 # quickjs-ng v0.18.0
TREES="blitz tauri stylo muda rquickjs-core rquickjs-sys"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git_at() { # URL REV DIR
  git init -q "$3"
  git -C "$3" fetch -q --depth 1 "$1" "$2"
  git -C "$3" -c advice.detachedHead=false checkout -q FETCH_HEAD
}

crate() { # NAME VERSION DEST: a crates.io package, from cargo's cache when it has it
  file=$(ls "${CARGO_HOME:-$HOME/.cargo}"/registry/cache/*/"$1-$2.crate" 2>/dev/null | head -n 1)
  if [ -z "$file" ]; then
    file="$tmp/$1-$2.crate"
    curl -sSfL "https://static.crates.io/crates/$1/$1-$2.crate" -o "$file"
  fi
  tar -xzf "$file" -C "$tmp"
  mv "$tmp/$1-$2" "$3"
  rm -f "$3/.cargo_vcs_info.json" "$3/Cargo.toml.orig" "$3/CHANGELOG.md"
}

upstream() { # DIR: the unpatched trees
  mkdir -p "$1/blitz/packages" "$1/tauri/crates"
  git_at https://github.com/DioxusLabs/blitz "$BLITZ_REV" "$tmp/blitz"
  for p in blitz-dom blitz-html blitz-paint blitz-traits stylo_taffy debug_timer; do
    cp -R "$tmp/blitz/packages/$p" "$1/blitz/packages/"
  done
  cp "$tmp/blitz/Cargo.toml" "$tmp"/blitz/LICENSE* "$1/blitz/"
  git_at https://github.com/readest/tauri "$TAURI_REV" "$tmp/tauri"
  for c in tauri tauri-runtime tauri-utils tauri-build tauri-codegen tauri-macros tauri-plugin; do
    cp -R "$tmp/tauri/crates/$c" "$1/tauri/crates/"
    rm -rf "$1/tauri/crates/$c/test" "$1/tauri/crates/$c/CHANGELOG.md"
  done
  cp "$tmp/tauri/Cargo.toml" "$tmp"/tauri/LICENSE* "$1/tauri/"
  git_at https://github.com/servo/stylo "$STYLO_REV" "$tmp/stylo"
  mkdir -p "$1/stylo"
  for c in malloc_size_of selectors servo_arc style style_derive style_traits stylo_atoms stylo_dom \
    stylo_static_prefs to_shmem to_shmem_derive; do
    cp -R "$tmp/stylo/$c" "$1/stylo/"
  done
  cp "$tmp/stylo/Cargo.toml" "$1/stylo/"
  crate muda 0.19.3 "$1/muda"
  crate rquickjs-core 0.10.0 "$1/rquickjs-core"
  crate rquickjs-sys 0.10.0 "$1/rquickjs-sys"
  git_at https://github.com/quickjs-ng/quickjs "$QUICKJS_REV" "$tmp/quickjs"
  rm -rf "$1/rquickjs-sys/quickjs"
  mkdir "$1/rquickjs-sys/quickjs"
  cp "$tmp"/quickjs/*.c "$tmp"/quickjs/*.h "$tmp/quickjs/LICENSE" "$1/rquickjs-sys/quickjs/"
  mkdir "$1/web-streams-polyfill"
  curl -sSfL https://registry.npmjs.org/web-streams-polyfill/-/web-streams-polyfill-3.3.3.tgz | tar -xz -C "$tmp"
  cp "$tmp/package/dist/polyfill.es2018.min.js" "$tmp/package/LICENSE" "$1/web-streams-polyfill/"
}

if [ "$1" = diff ]; then
  upstream "$tmp/upstream"
  for t in $TREES; do
    # no timestamps in the headers, so a regenerated patch only changes where the code did
    (cd "$tmp/upstream" && diff -ruN "$t" "$OLDPWD/vendor/$t" | sed -e "s|$OLDPWD/vendor/||" \
      -e 's/^\(--- [^	]*\)	.*/\1/' -e 's/^\(+++ [^	]*\)	.*/\1/') > "patches/$t.diff" || true
  done
  exit 0
fi

rm -rf vendor
upstream vendor
for t in $TREES; do
  patch -s -p0 -d vendor < "patches/$t.diff"
done
