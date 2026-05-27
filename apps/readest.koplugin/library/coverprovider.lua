-- coverprovider.lua
-- Resolves a Library row to a renderable cover. For local books we lean on
-- the bundled coverbrowser.koplugin's BookInfoManager (it already has a
-- battle-tested extraction subprocess + zstd-compressed BLOB cache); for
-- cloud-only books we download `cover.png` from Readest storage and render
-- it via plain ImageWidget{file=path}.
--
-- Hard dependency on coverbrowser, mirroring zen_ui's pattern: at plugin
-- init we check `coverbrowser_loaded()`. If the user has it disabled, the
-- caller offers to enable it; until then, every cell renders FakeCover
-- (no degraded grid mode).
--
-- The pure helpers (coverbrowser_loaded, cached_cover_path, MISSING) are
-- exported and unit-tested. The actual blitbuffer-returning calls
-- (get_local_cover, get_cloud_cover) require live KOReader and are
-- exercised manually.

local logger = require("logger")

local M = {}

-- ---------------------------------------------------------------------------
-- Constants
-- ---------------------------------------------------------------------------
-- Sentinel written into books.cover_path when a cloud cover download
-- returned 404. Distinguishable from any real path so callers can short-
-- circuit FakeCover rendering without re-attempting the download every
-- frame.
M.MISSING = "_missing"

-- ---------------------------------------------------------------------------
-- coverbrowser_loaded
-- ---------------------------------------------------------------------------
-- True if `require("covermenu")` will resolve. coverbrowser.koplugin is the
-- only thing that ships the covermenu module, so this doubles as a "is the
-- plugin enabled?" check.
function M.coverbrowser_loaded()
    if package.loaded["covermenu"] then return true end
    if package.preload["covermenu"] then return true end
    -- pcall(require) costs <1ms but populates package.loaded on success;
    -- callers shouldn't pay that cost twice.
    local ok = pcall(require, "covermenu")
    return ok == true
end

-- ---------------------------------------------------------------------------
-- cached_cover_path
-- ---------------------------------------------------------------------------
-- Where we store a downloaded cloud cover. Flat layout under the plugin's
-- cache dir, keyed by hash so collisions can't happen.
function M.cached_cover_path(covers_dir, hash)
    if not covers_dir or covers_dir == "" then return nil end
    if not hash or hash == "" then return nil end
    return covers_dir .. "/" .. hash .. ".png"
end

-- ---------------------------------------------------------------------------
-- get_local_cover(file_path) → blitbuffer or nil
-- ---------------------------------------------------------------------------
-- Live-KOReader-only. Looks up the book in BookInfoManager's cache; if it's
-- not there, kicks off background extraction (which writes the bb back into
-- BIM next time the user paints). Returns nil immediately on cache miss so
-- the caller can render FakeCover meanwhile.
function M.get_local_cover(file_path)
    if not file_path then return nil end
    local ok, BIM = pcall(require, "bookinfomanager")
    if not ok or not BIM then return nil end

    local info = BIM:getBookInfo(file_path, true)
    if info and info.cover_bb then return info.cover_bb end

    -- Cache miss: ask BIM to extract in the background.
    BIM:extractInBackground({ { file_path } })
    return nil
end

-- ---------------------------------------------------------------------------
-- get_cloud_cover(book, opts, on_ready) — async; opts must include sync auth
-- + a covers_dir + a settings table.
-- ---------------------------------------------------------------------------
-- If the cover is already on disk, returns its path synchronously.
-- Otherwise schedules a download via syncbooks.downloadCover and invokes
-- on_ready(path_or_missing) when it completes. on_ready may be nil when the
-- caller just wants to kick off the prefetch.
function M.get_cloud_cover(book, opts, on_ready)
    if not book or not book.hash then
        if on_ready then on_ready(nil) end
        return nil
    end

    local lfs = require("libs/libkoreader-lfs")
    local cached = M.cached_cover_path(opts.covers_dir, book.hash)
    if cached and lfs.attributes(cached, "mode") == "file" then
        return cached
    end

    -- Don't retry a known-missing cover (avoids a 404 storm on every paint).
    if book.cover_path == M.MISSING then return nil end

    local syncbooks = require("library.syncbooks")
    syncbooks.downloadCover(book, opts, function(success, path_or_err, status)
        if success then
            if on_ready then on_ready(path_or_err) end
        else
            if status == 404 then
                if on_ready then on_ready(M.MISSING) end
            else
                logger.dbg("ReadestLibrary cover download failed:", path_or_err, status)
                if on_ready then on_ready(nil) end
            end
        end
    end)
    return nil  -- caller renders FakeCover until on_ready fires
end

return M
