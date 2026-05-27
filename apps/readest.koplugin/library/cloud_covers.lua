-- cloud_covers.lua
-- Per-book cover lifecycle for cloud-only rows. Owns the on-disk
-- <hash>.png cache, the synthetic readest-cloud:// URI scheme, and
-- the single-slot async download queue that fetches missing covers
-- from Readest storage when their cells become visible.
--
-- The disk cache is shared with hybrid (cloud+local) rows so a
-- previously-downloaded cloud cover gets reused for the local
-- presentation of the same hash without a re-extraction pass.

local logger = require("logger")

local M = {}

M.URI_PREFIX = "readest-cloud://"

-- Synthetic-info metadata cache: keyed by either hash (cloud-only
-- entries) or the full URI string (group entries). Values:
--   { title, author }
-- The patched BIM reads these to fill in title/authors so MosaicMenu's
-- FakeCover renders meaningful text instead of "?".
local _meta = {}

-- Download lifecycle state
local _cover_pending  = {}   -- hash → true while a download is in flight
local _missing_covers = {}   -- hash → true after a 404 (don't keep retrying)
local _visible_hashes = nil  -- set of hashes on the current Menu page; nil = no filter
local _refresh_pending = false  -- coalesces multiple cover-completion refreshes
local _download_queue = {}   -- FIFO list of pending hashes
local _downloading    = false -- gate: only one socket.http active at a time

-- Sync-auth opts (set via M.set_opts at install time). Holds
-- sync_auth, sync_path, settings — needed to drive syncbooks.downloadCover.
local _opts = nil

function M.set_opts(opts)
    _opts = opts
end

function M.set_meta(key, meta)
    _meta[key] = meta
end

function M.get_meta(key)
    return _meta[key] or {}
end

function M.covers_dir()
    local DataStorage = require("datastorage")
    return DataStorage:getSettingsDir() .. "/readest_covers"
end

local function cover_path_for(hash)
    return M.covers_dir() .. "/" .. hash .. ".png"
end

-- Strip the .ext suffix so callers get just the partial-md5. The .ext
-- is encoded into the URI so listmenu's filemanagerutil.splitFileNameType
-- returns a non-nil filetype (listmenu.lua:316); without it the
-- right-column composition crashes on string concat.
function M.hash_from_uri(filepath)
    local rest = filepath:sub(#M.URI_PREFIX + 1)
    return (rest:match("^([^.]+)") or rest)
end

-- Load <hash>.png from disk into a fresh blitbuffer. Returns nil if the
-- file doesn't exist or fails to decode. Caller owns the bb (ImageWidget
-- will free it). No in-memory cache — ImageWidget treats the bb as
-- disposable, so sharing one across paints leads to use-after-free.
function M.load_cover_bb(hash)
    local lfs = require("libs/libkoreader-lfs")
    local path = cover_path_for(hash)
    if lfs.attributes(path, "mode") ~= "file" then return nil end
    local ok, RenderImage = pcall(require, "ui/renderimage")
    if not ok then return nil end
    local ok2, bb = pcall(RenderImage.renderImageFile, RenderImage, path, false)
    if not ok2 or not bb then return nil end
    return bb
end

-- "<hash8> '<title>'" formatted log tag — searchable by either id.
local function tag_for(hash)
    local meta = _meta[hash] or {}
    return hash:sub(1, 8) .. " '" .. tostring(meta.title or "?") .. "'"
end

-- Pump the next entry off _download_queue. Re-entrant-safe via the
-- _downloading gate. Filters known-404 hashes and hashes that have
-- scrolled off-screen since they were enqueued.
local function process_queue()
    if _downloading then return end
    local hash
    repeat
        hash = table.remove(_download_queue, 1)
        if not hash then return end
        if _missing_covers[hash] then
            _cover_pending[hash] = nil
            hash = nil
        elseif _visible_hashes and not _visible_hashes[hash] then
            logger.dbg("ReadestLibrary cover dequeue skip: " .. tag_for(hash)
                .. " no longer on visible page")
            _cover_pending[hash] = nil
            hash = nil
        end
    until hash

    _downloading = true
    logger.info("ReadestLibrary cover download: starting " .. tag_for(hash))
    local syncbooks = require("library.syncbooks")
    syncbooks.downloadCover(
        { hash = hash },
        {
            sync_auth  = _opts and _opts.sync_auth,
            sync_path  = _opts and _opts.sync_path,
            settings   = _opts and _opts.settings,
            covers_dir = M.covers_dir(),
        },
        function(success, path_or_err, status)
            _cover_pending[hash] = nil
            _downloading = false
            if not success then
                if status == 404 then
                    _missing_covers[hash] = true
                    logger.info("ReadestLibrary cover " .. tag_for(hash)
                        .. " — no cover on server (404), won't retry")
                else
                    logger.warn("ReadestLibrary cover " .. tag_for(hash)
                        .. " download failed: " .. tostring(path_or_err)
                        .. " status=" .. tostring(status))
                end
            else
                logger.info("ReadestLibrary cover " .. tag_for(hash)
                    .. " saved → " .. tostring(path_or_err))
                -- Coalesce refresh: multiple covers landing in the same
                -- tick still get one repaint, not N flickering redraws.
                if not _refresh_pending then
                    _refresh_pending = true
                    local UIManager = require("ui/uimanager")
                    UIManager:nextTick(function()
                        _refresh_pending = false
                        local ok, LibraryWidget = pcall(require, "library.librarywidget")
                        if ok and LibraryWidget._menu then LibraryWidget.refresh() end
                    end)
                end
            end
            -- Yield to the UI loop before pumping the next one.
            local UIManager = require("ui/uimanager")
            UIManager:nextTick(process_queue)
        end)
end

-- Idempotent against in-flight requests and known-404 hashes. Only
-- fires for hashes the caller has marked as visible via M.set_visible_hashes
-- — otherwise paint stragglers / poll loops for off-screen items would
-- queue downloads the user can't see.
function M.trigger_download(hash)
    if _cover_pending[hash] then
        logger.dbg("ReadestLibrary cover skip: " .. tag_for(hash) .. " already in flight")
        return
    end
    if _missing_covers[hash] then
        logger.dbg("ReadestLibrary cover skip: " .. tag_for(hash) .. " known 404")
        return
    end
    if not _opts or not _opts.sync_auth then
        logger.warn("ReadestLibrary cover skip: " .. tag_for(hash)
            .. " — set_opts not called yet")
        return
    end
    if _visible_hashes and not _visible_hashes[hash] then
        logger.dbg("ReadestLibrary cover skip: " .. tag_for(hash) .. " not on visible page")
        return
    end

    _cover_pending[hash] = true
    table.insert(_download_queue, hash)
    logger.dbg("ReadestLibrary cover queued: " .. tag_for(hash)
        .. " (queue len=" .. #_download_queue .. ")")
    process_queue()
end

-- Set of hashes whose covers may trigger downloads on the current Menu
-- page. Pass nil to disable the filter (e.g. when the Library closes and
-- the patched BIM might still be invoked from elsewhere). Caller is
-- responsible for computing the set: cloud-only book entries contribute
-- their own hash; group entries contribute their children's hashes (so
-- the patched BIM can fetch covers for the mosaic composite).
function M.set_visible_hashes(set)
    if set == nil then
        logger.dbg("ReadestLibrary set_visible_hashes: cleared")
        _visible_hashes = nil
        return
    end
    _visible_hashes = set
    local count = 0
    for _ in pairs(set) do count = count + 1 end
    logger.info("ReadestLibrary set_visible_hashes: count=" .. count)
end

return M
