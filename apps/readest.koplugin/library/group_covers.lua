-- group_covers.lua
-- macOS-style folder previews: a 2x2 mosaic of the first N child book
-- covers, served as a synthetic readest-group:// URI through the
-- patched BookInfoManager.
--
-- Composites are cached in memory (per group) and composed off the paint
-- path — see the "Mosaic cache + background compositing" section below.
-- We deliberately keep NO on-disk cache: an earlier version wrote PNGs
-- under <settings>/readest_group_covers/ fingerprinted by child hashes,
-- but a partial composite written while children's covers were still
-- downloading kept serving forever, because the hash-only fingerprint
-- didn't change once the late covers arrived. The in-memory cache keys on
-- child-cover *availability* too, so a late cover flips the key and forces
-- exactly one recompose.

local logger       = require("logger")
local cloud_covers = require("library.cloud_covers")

local M = {}

M.URI_PREFIX = "readest-group://"

-- Layouts:
--   "grid" — 2x2, 360x480 (3:4 — typical book-cover aspect).
--   "list" — 2x2, 480x480 (square — matches ListMenu's rigid square
--   cover slot, so the composite fills it vertically and each
--   mini-cover stays book-shaped instead of getting squished).
M.LAYOUTS = {
    grid = { target_w = 360, target_h = 480, cols = 2, rows = 2 },
    list = { target_w = 480, target_h = 480, cols = 2, rows = 2 },
}

-- "Asimov" → "417369..." — filesystem-safe regardless of slashes,
-- colons, etc. in the original group value.
local function hex_encode(s)
    return (s:gsub(".", function(c) return string.format("%02x", string.byte(c)) end))
end

local function hex_decode(hex)
    return (hex:gsub("..", function(h) return string.char(tonumber(h, 16)) end))
end

-- shape ∈ {"grid", "list"} — controls the composite layout. Defaults
-- to "grid" for backward compat with older callers.
function M.build_uri(group_by, value, shape)
    return M.URI_PREFIX .. group_by .. ":" .. hex_encode(value)
        .. ":" .. (shape or "grid") .. ".png"
end

-- Returns group_by, value, shape; nil if not a group URI.
function M.parse_uri(uri)
    if uri:sub(1, #M.URI_PREFIX) ~= M.URI_PREFIX then return nil end
    local body = uri:sub(#M.URI_PREFIX + 1)
    if body:sub(-4) == ".png" then body = body:sub(1, -5) end
    local parts = {}
    for p in body:gmatch("[^:]+") do parts[#parts + 1] = p end
    if #parts < 2 then return nil end
    local group_by = parts[1]
    local hex      = parts[2]
    local shape    = parts[3] or "grid"
    local value    = hex_decode(hex)
    return group_by, value, shape
end

-- Pull a usable cover bb for a single child book during composition.
-- Tries (in order):
--   1. local file via the original BIM cache (already-cached only;
--      no extraction triggered)
--   2. cloud cover .png we previously downloaded
-- Returns nil if neither path produces one. Caller owns the bb.
--
-- When (2) misses for a cloud-present book, queue a cloud-cover download
-- so a subsequent paint can complete the mosaic. Without this hook a
-- freshly-pulled library renders every group as FakeCover until the user
-- drills into each one, because cloud_covers' download queue is only
-- primed for cloud-only book entries on the visible page — group cells
-- never appear there themselves, so their children's covers were never
-- requested.
function M.child_cover_bb(book, orig_getBookInfo, BIM)
    if not book then return nil end
    if book.local_present == 1 and book.file_path and orig_getBookInfo then
        local ok, info = pcall(orig_getBookInfo, BIM, book.file_path, true)
        if ok and info and info.has_cover and info.cover_bb then
            -- BIM hands us a cached bb whose ownership it keeps; we copy
            -- before scaling so the BIM cache stays intact when our
            -- composition pipeline frees what it received.
            local Blitbuffer = require("ffi/blitbuffer")
            local copy = Blitbuffer.new(info.cover_bb:getWidth(),
                                        info.cover_bb:getHeight(),
                                        info.cover_bb:getType())
            copy:blitFrom(info.cover_bb, 0, 0, 0, 0,
                          info.cover_bb:getWidth(), info.cover_bb:getHeight())
            return copy
        end
    end
    if not book.hash or book.hash == "" then return nil end
    local bb = cloud_covers.load_cover_bb(book.hash)
    if bb then return bb end
    if (book.cloud_present or 0) == 1 then
        cloud_covers.trigger_download(book.hash)
    end
    return nil
end

-- Compose up to N child covers into a mosaic, returning a fresh bb that
-- the caller (ImageWidget) takes ownership of. Returns nil if no child
-- produced a cover. Intentionally regenerated on every paint — see the
-- module-level comment.
local function compose(books, shape, orig_getBookInfo, BIM)
    if #books == 0 then return nil end
    local layout = M.LAYOUTS[shape] or M.LAYOUTS.grid
    local target_w, target_h = layout.target_w, layout.target_h
    local cols, rows = layout.cols, layout.rows
    local max_cells = cols * rows
    local expected = math.min(max_cells, #books)

    local Blitbuffer = require("ffi/blitbuffer")
    local target = Blitbuffer.new(target_w, target_h, Blitbuffer.TYPE_BBRGB32)
    target:fill(Blitbuffer.COLOR_WHITE)

    local gap = 8
    local cell_w = math.floor((target_w - (cols - 1) * gap) / cols)
    local cell_h = math.floor((target_h - (rows - 1) * gap) / rows)
    local placed = 0

    for i = 1, expected do
        local book = books[i]
        local cover = M.child_cover_bb(book, orig_getBookInfo, BIM)
        if cover then
            local row = math.floor((i - 1) / cols)
            local col = (i - 1) % cols
            local dx = col * (cell_w + gap)
            local dy = row * (cell_h + gap)
            local ok_scale, scaled = pcall(cover.scale, cover, cell_w, cell_h)
            if ok_scale and scaled then
                target:blitFrom(scaled, dx, dy, 0, 0, cell_w, cell_h)
                scaled:free()
                placed = placed + 1
            end
            cover:free()
        end
    end

    if placed == 0 then
        target:free()
        return nil
    end
    return target
end

-- Cells-per-mosaic for a given shape. Used by callers to know how many
-- books to fetch from the store.
function M.cells_for(shape)
    local layout = M.LAYOUTS[shape] or M.LAYOUTS.grid
    return layout.cols * layout.rows
end

-- ---------------------------------------------------------------------------
-- Mosaic cache + background compositing (issue #4954)
-- ---------------------------------------------------------------------------
-- Recomposing a folder mosaic on every paint (up to 4 MuPDF cover decodes +
-- scales per cell) dominated the Library's open cost on large libraries.
-- Two fixes, mirroring cloud_covers' async download pattern:
--   * cache the composed master bb per group, keyed by a signature that
--     flips when the child set OR any child's cover availability changes;
--     serve cheap copies on a hit.
--   * compose off the first-paint path: a miss enqueues a background job
--     (one per UI tick) and returns nil so the cell paints its FakeCover
--     placeholder immediately; finished mosaics coalesce into one refresh.
local _mosaic_cache    = {}    -- identity → { key = signature, bb = master }
local _compose_queue   = {}    -- FIFO of pending compose jobs
local _compose_pending = {}    -- identity → true while queued/in-flight
local _refresh_pending = false
local _pump_scheduled  = false

-- Whether a child's cover can be produced without a network fetch: a local
-- book whose file is on disk, or a cloud book whose <hash>.png is cached.
-- Cheap (a stat, no image decode) — only used to build the cache signature.
function M.child_cover_available(book)
    if not book then return false end
    if book.local_present == 1 and book.file_path then
        local lfs = require("libs/libkoreader-lfs")
        if lfs.attributes(book.file_path, "mode") == "file" then return true end
    end
    if book.hash and book.hash ~= "" and cloud_covers.cover_exists(book.hash) then
        return true
    end
    return false
end

-- Signature that changes exactly when a mosaic's inputs change: the ordered
-- child hashes plus a per-child cover-availability bit. A keyed lookup on
-- this recomposes on child-set changes and when a missing cover arrives, and
-- hits otherwise. "\0" joins fields that can't contain it.
function M.mosaic_cache_key(group_by, value, shape, books)
    local n = M.cells_for(shape)
    local parts = {}
    for i = 1, math.min(n, #books) do
        local b = books[i]
        parts[i] = (b.hash or "?") .. (M.child_cover_available(b) and "+" or "-")
    end
    return table.concat({ group_by, value, shape, table.concat(parts, ",") }, "\0")
end

-- ImageWidget frees whatever bb it's handed, so the cached master can't be
-- shared directly — every serve returns a disposable copy.
local function copy_bb(src)
    local Blitbuffer = require("ffi/blitbuffer")
    local dst = Blitbuffer.new(src:getWidth(), src:getHeight(), src:getType())
    dst:blitFrom(src, 0, 0, 0, 0, src:getWidth(), src:getHeight())
    return dst
end

local function store_master(identity, key, bb)
    local prev = _mosaic_cache[identity]
    if prev and prev.bb and prev.bb ~= bb then prev.bb:free() end
    _mosaic_cache[identity] = { key = key, bb = bb }
end

-- Coalesce mosaic-completion repaints: many mosaics landing across ticks
-- still trigger one Library refresh, not a flicker storm.
local function schedule_refresh()
    if _refresh_pending then return end
    _refresh_pending = true
    local UIManager = require("ui/uimanager")
    UIManager:nextTick(function()
        _refresh_pending = false
        local ok, LibraryWidget = pcall(require, "library.librarywidget")
        if ok and LibraryWidget._menu then LibraryWidget.refresh() end
    end)
end

-- Background compose pump: one mosaic per UI tick so a page of folders fills
-- in progressively instead of freezing the paint. _pump_scheduled coalesces
-- the nextTick so N misses in one paint don't stack N pumps.
local process_compose_queue  -- forward declaration for schedule_pump

local function schedule_pump()
    if _pump_scheduled then return end
    _pump_scheduled = true
    local UIManager = require("ui/uimanager")
    UIManager:nextTick(process_compose_queue)
end

process_compose_queue = function()
    _pump_scheduled = false
    local job = table.remove(_compose_queue, 1)
    if not job then return end
    _compose_pending[job.identity] = nil
    -- Cache the result under this availability signature even when compose
    -- returns nil (no child cover ready → the cell keeps its FakeCover
    -- placeholder). Without caching the nil, a coverless group would miss
    -- and recompose on every refresh forever; a later cover download flips
    -- the signature (the key), which misses and recomposes exactly once.
    store_master(job.identity, job.key, compose(job.books, job.shape,
        job.orig_getBookInfo, job.BIM))
    schedule_refresh()
    if #_compose_queue > 0 then schedule_pump() end
end

local function enqueue_compose(job)
    if _compose_pending[job.identity] then return end
    _compose_pending[job.identity] = true
    _compose_queue[#_compose_queue + 1] = job
    schedule_pump()
end

-- High-level: resolve the group's first-N children, then either serve the
-- cached master (as a copy) or enqueue a background compose and return nil
-- so the cell shows its FakeCover placeholder until the mosaic lands. Second
-- return is the resolved child list, so callers reuse it without re-querying.
function M.serve_or_compose(group_by, value, shape,
                            store, settings, orig_getBookInfo, BIM)
    if not store then return nil, {} end
    local n = M.cells_for(shape)
    local books = store:listBooksInGroup(group_by, value, n, {
        sort_by  = settings and settings.library_sort_by,
        sort_asc = settings and settings.library_sort_ascending == true,
    })
    local identity = table.concat({ group_by, value, shape }, "\0")
    local key = M.mosaic_cache_key(group_by, value, shape, books)
    local entry = _mosaic_cache[identity]
    if entry and entry.key == key then
        -- Already composed for this exact signature: serve a copy of the
        -- master, or nil (placeholder) if no cover was available — but do
        -- NOT re-enqueue, else a coverless group recomposes every refresh.
        return entry.bb and copy_bb(entry.bb) or nil, books
    end
    enqueue_compose({
        identity = identity, key = key, books = books, shape = shape,
        orig_getBookInfo = orig_getBookInfo, BIM = BIM,
    })
    logger.dbg("ReadestLibrary mosaic miss, composing in background: " .. identity)
    return nil, books
end

-- Free cached masters when the Library closes so a big grid doesn't pin
-- ~0.7MB per folder for the app's lifetime; reopen recomposes in the
-- background (non-blocking).
function M.clear_cache()
    for _identity, entry in pairs(_mosaic_cache) do
        if entry.bb then entry.bb:free() end
    end
    _mosaic_cache = {}
    _compose_queue = {}
    _compose_pending = {}
end

return M
