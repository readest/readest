---
name: rust-objcopy-misaligned-dylib-xcode27
description: "E0463 \"can't find crate for tauri_macros\" on macOS 27 + Xcode 27.1 is an old rust-objcopy misaligning stripped dylibs; update Rust"
metadata:
  node_type: memory
  type: reference
  originSessionId: c56d4eea-663c-4a14-8596-6cfe682f38b9
  modified: 2026-11-05T23:31:58.802Z
---

`pnpm tauri build` on macOS 27 with Xcode 27.1 failed with `error[E0463]: can't find crate for tauri_macros` while the dylib existed and had valid metadata. Seen 2026-11-06 on Rust 1.92.

Cause: rustc's post-link strip (`rust-objcopy`, Cargo's default `strip=debuginfo` in release) leaves the LINKEDIT string pool 4-byte aligned when the deployment target is >= 12.0 (tauri CLI sets it from `minimumSystemVersion`). dyld rejects that for dylibs linked against SDK 27: `mis-aligned LINKEDIT string pool`. Dylibs from the older SDK 26.x with the same misalignment still load, and executables still launch.

rustc hides it: the speculative proc-macro load swallows the `dlopen` error, and the retry reports plain E0463 with no notes.

Fix: `rustup update stable`. A minimal proc-macro failed on 1.92 and passed on 1.99.1 under all strip modes; the first fixed version between them was not narrowed. `cargo clean` does not help on the old toolchain, since the rebuilt dylib is misaligned again.

Diagnose: `python3 -c "import ctypes,sys; ctypes.CDLL(sys.argv[1])" <dylib>` prints the real dyld error. A misaligned file has `stroff % 8 == 4` in LC_SYMTAB.

The `target` dir is a symlink to /Volumes/ExternalSSD/dev-cache/readest/target. See [[build-ci-recipes]].
