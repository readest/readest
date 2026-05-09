# readest.koplugin tests

Unit tests for `apps/readest.koplugin/library/` modules. Runs under **LuaJIT
2.1** (the runtime KOReader uses) via [busted](https://lunarmodules.github.io/busted/).

## Toolchain

One-time per machine:

```bash
# macOS
brew install luajit luarocks

# Linux (Debian/Ubuntu)
sudo apt-get install luajit luarocks

# Then, regardless of OS:
luarocks --lua-version=5.1 install busted
luarocks --lua-version=5.1 install lsqlite3complete
```

The `--lua-version=5.1` flag is required: LuaJIT identifies itself as Lua 5.1, and we install rocks against that runtime so production code (which targets LuaJIT) and test code share a Lua interpreter.

## Running

From the repo root:

```bash
pnpm test:lua
```

Or from this directory:

```bash
eval "$(luarocks --lua-version=5.1 path)"
busted --lua=$(which luajit)
```

## Layout

```
spec/
├── spec_helper.lua      # KOReader stubs + lua-ljsqlite3 shim (loaded once)
├── library/
│   ├── smoke_spec.lua   # Sanity check that the harness boots
│   └── *_spec.lua       # One per module under library/
└── README.md            # This file
```

## What `spec_helper` provides

- **`require("lua-ljsqlite3/init")`** → returns a SQLite shim wrapping `lsqlite3complete`. Exposes the subset of the lua-ljsqlite3 API our library modules use (`open`, `exec`, `prepare`, `bind1`, `step`, `reset`, `clearbind`, `close`, etc).
- **`require("logger")`** → no-op logger (`warn`/`info`/`dbg`/`err` callable).
- **`require("datastorage")`** → fake `DataStorage:getSettingsDir()` returning a per-test `mktemp -d` path.
- **`require("device")`** → stub `Device.canUseWAL() == true`, `Device.screen` with `getWidth/getHeight`.
- **`G_reader_settings`** (global) → in-memory `readSetting`/`saveSetting`/`flush`.

Each spec calls `require("spec_helper").reset()` in `before_each` to wipe state.

## Adding a new module

1. Write production code at `apps/readest.koplugin/library/foo.lua`.
2. Write `apps/readest.koplugin/spec/library/foo_spec.lua`.
3. Run `pnpm test:lua` from the repo root.
4. Run `pnpm lint:lua` to syntax-check (LuaJIT bytecode compile).

## Why LuaJIT and not stock Lua?

KOReader runs LuaJIT exclusively. LuaJIT extends Lua 5.1 with FFI and a few syntax tweaks; stock Lua 5.4 has features (integer division `//`, bit operators `~`, `<const>` annotations) that LuaJIT rejects. Running tests under LuaJIT catches these incompatibilities at test time instead of when KOReader fails to load the plugin.
