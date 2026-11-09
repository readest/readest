#!/usr/bin/env bash
# Readest Lite for the Kindle Voyage as one static binary: armv7 hard-float musl, +crt-static.
# The device's userland is soft-float glibc 2.20 with cairo 1.10; a static binary loads none of it.
# freetype, pixman and cairo (image surface + FreeType fonts; no fontconfig, png, zlib, X or glib)
# are cross-built once with host clang into $WORK; cargo then rebuilds whatever the tree holds.
#
#   scripts/build-kindle.sh          # prints the binary's path at the end
#
# Needs clang, ld.lld, llvm-ar, meson, ninja, make and the Rust target (added here). dist/ must
# exist (scripts/build-frontend.sh, SKIP_APP_BUILD=1 to reuse readest-app's export).
set -euo pipefail

LITE=$(cd "$(dirname "$0")/.." && pwd)
WORK=${KINDLE_WORK:-/run/media/chrox/Backup/dev/kindle-cef/lite-kindle}
T=armv7-unknown-linux-musleabihf
SYSROOT=$WORK/sysroot   # musl headers + Rust's self-contained crt objects and libc.a
PREFIX=$WORK/prefix     # static freetype, pixman, cairo
MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian/pool/main
ARCH_FLAGS=(--target=$T -march=armv7-a -mfpu=neon -mfloat-abi=hard)
mkdir -p "$WORK"/{dl,src,build}

# fetch NAME POOL-PATH SHA256: download (direct, the env proxy is slow) and unpack into src/NAME.
fetch() {
  local tar=$WORK/dl/${2##*/}
  [ -d "$WORK/src/$1" ] && return
  [ -f "$tar" ] || curl --noproxy '*' -fL -o "$tar" "$MIRROR/$2"
  echo "$3  $tar" | sha256sum -c --quiet
  mkdir "$WORK/src/$1.tmp" && tar -xf "$tar" -C "$WORK/src/$1.tmp" --strip-components=1
  mv "$WORK/src/$1.tmp" "$WORK/src/$1"
}
fetch musl m/musl/musl_1.2.5.orig.tar.gz a9a118bbe84d8764da0ea0d28b3ab3fae8477fc7e4085d90102b8596fc7c75e4
fetch freetype f/freetype/freetype_2.14.3%2Bdfsg.orig.tar.xz dc1bec263a6fffa436029efe6428f601d6b1a0b800837508ee3e49bbab8f1006
fetch pixman p/pixman/pixman_0.46.4.orig.tar.gz d09c44ebc3bd5bee7021c79f922fe8fb2fb57f7320f55e97ff9914d2346a591c
fetch cairo c/cairo/cairo_1.18.4.orig.tar.xz 445ed8208a6e4823de1226a74ca319d3600e83f6369f99b14265006599c32ccb

rustup target list --installed | grep -qx $T || rustup target add $T

# Sysroot: musl 1.2.5 headers (Rust's self-contained libc.a is 1.2.5) and its crt/libc for the
# link checks meson runs. clang -static also asks for crtbeginT.o (= crtbegin.o) and libgcc:
# Rust's compiler_builtins (the __aeabi_* helpers libc.a calls) plus a stub for the unwinder
# personality it names. Only meson's checks link against these; rustc links the binary itself.
# Empty libm/libpthread/... as musl installs them (it keeps all of them in libc.a).
RLIB=$(rustc --print sysroot)/lib/rustlib/$T/lib
if [ ! -f "$SYSROOT/usr/lib/libpthread.a" ]; then
  make -s -C "$WORK/src/musl" ARCH=arm prefix=/usr DESTDIR="$SYSROOT" install-headers >/dev/null
  mkdir -p "$SYSROOT/usr/lib"
  cp "$RLIB/self-contained/"*.[oa] "$SYSROOT/usr/lib/"
  cp "$SYSROOT/usr/lib/crtbegin.o" "$SYSROOT/usr/lib/crtbeginT.o"
  cp "$RLIB"/libcompiler_builtins-*.rlib "$SYSROOT/usr/lib/libgcc.a"
  echo 'void rust_eh_personality(void) { __builtin_trap(); }' |
    clang "${ARCH_FLAGS[@]}" -x c -c - -o "$SYSROOT/usr/lib/eh.o"
  llvm-ar rc "$SYSROOT/usr/lib/libgcc_eh.a" "$SYSROOT/usr/lib/eh.o"
  for l in m rt crypt util xnet resolv dl pthread; do llvm-ar rc "$SYSROOT/usr/lib/lib$l.a"; done
fi

quote() { printf "'%s', " "$@"; }
cat >"$WORK/cross.ini" <<EOF
[binaries]
c = ['clang', $(quote "${ARCH_FLAGS[@]}") '--sysroot=$SYSROOT']
ar = 'llvm-ar'
strip = 'llvm-strip'
pkg-config = 'pkg-config'
[built-in options]
c_link_args = ['-fuse-ld=lld', '-static']
[properties]
pkg_config_libdir = '$PREFIX/lib/pkgconfig'
needs_exe_wrapper = true
[host_machine]
system = 'linux'
cpu_family = 'arm'
cpu = 'armv7'
endian = 'little'
EOF

# meson_dep NAME OPTIONS...: static build into $PREFIX, once per source tree.
RELINK=
meson_dep() {
  local name=$1; shift
  [ -f "$WORK/build/$name.done" ] && return
  RELINK=1
  rm -rf "$WORK/build/$name"
  meson setup "$WORK/build/$name" "$WORK/src/$name" --cross-file "$WORK/cross.ini" \
    --prefix "$PREFIX" --libdir lib --buildtype release --default-library static "$@"
  ninja -C "$WORK/build/$name" install
  touch "$WORK/build/$name.done"
}
meson_dep freetype -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled -Dpng=disabled \
  -Dzlib=disabled -Dtests=disabled
meson_dep pixman -Dgtk=disabled -Dlibpng=disabled -Dopenmp=disabled -Dtests=disabled \
  -Ddemos=disabled
meson_dep cairo -Dfreetype=enabled -Dfontconfig=disabled -Dpng=disabled -Dzlib=disabled \
  -Dxcb=disabled -Dxlib=disabled -Dquartz=disabled -Ddwrite=disabled -Dtee=disabled \
  -Dglib=disabled -Dspectre=disabled -Dlzo=disabled -Dsymbol-lookup=disabled -Dtests=disabled

# Cargo: clang + lld as the linker (rustc passes Rust's self-contained musl crt and libc), cc and
# bindgen (rquickjs-sys) against the musl headers, cairo-sys/freetype from $PREFIX, statically.
TU=${T//-/_}
TUC=${TU^^}
export CC_$TU=clang AR_$TU=llvm-ar
export CFLAGS_$TU="${ARCH_FLAGS[*]} --sysroot=$SYSROOT"
export BINDGEN_EXTRA_CLANG_ARGS_$TU="${ARCH_FLAGS[*]} --sysroot=$SYSROOT"
export CARGO_TARGET_${TUC}_LINKER=clang
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS   # either would replace the target's flags below
export CARGO_TARGET_${TUC}_RUSTFLAGS="-C target-feature=+crt-static,+neon -C link-self-contained=yes \
-C link-arg=--target=$T -C link-arg=-fuse-ld=lld -C link-arg=--sysroot=$SYSROOT -L native=$PREFIX/lib"
export PKG_CONFIG_LIBDIR_$TU=$PREFIX/lib/pkgconfig PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_ALL_STATIC=1
export SYSTEM_DEPS_LINK=static
export CARGO_TARGET_DIR=$WORK/target   # off the host build's target/ lock

# No default features: `system-fonts` is fontconfig, and Lite's fonts come from BLITZ_FONTS.
cd "$LITE"
# cargo doesn't see a rebuilt libcairo.a & co.: drop the old link so it is redone.
[ -z "$RELINK" ] || cargo clean -q --release --target $T -p readest-lite
cargo build --release --target $T -p readest-lite --no-default-features --features window
echo "$CARGO_TARGET_DIR/$T/release/readest-lite"
