-- group_covers.lua
-- macOS-style folder previews: a 2x2 mosaic of the first N child book
-- covers, served as a synthetic readest-group:// URI through the
-- patched BookInfoManager. Composites are cached on disk under
--   <settings>/readest_group_covers/<key>.png
-- with the cache key derived from the actual first-N hashes, so any
-- change to the group's content (sort flip, add/remove, reordering
-- bump) auto-invalidates the cached PNG.

local logger = require("logger")
local cloud_covers = require("library.cloud_covers")

local M = {}

M.URI_PREFIX = "readest-group://"

-- Bump when the composite layout/dimensions change so existing on-disk
-- composites get regenerated on next paint instead of serving the old
-- aspect ratio forever.
local CACHE_VERSION = 3

-- Layouts:
--   "grid" — 2x2, 360x480 (3:4 — typical book-cover aspect).
--   "list" — 2x2, 480x480 (square — matches ListMenu's rigid square
--   cover slot, so the composite fills it vertically and each
--   mini-cover stays book-shaped instead of getting squished).
M.LAYOUTS = {
    grid = { target_w = 360, target_h = 480, cols = 2, rows = 2 },
    list = { target_w = 480, target_h = 480, cols = 2, rows = 2 },
}

local function group_covers_dir()
    local DataStorage = require("datastorage")
    return DataStorage:getSettingsDir() .. "/readest_group_covers"
end

local function group_cover_path(cache_key)
    return group_covers_dir() .. "/" .. cache_key .. "_v" .. CACHE_VERSION .. ".png"
end

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

-- Returns group_by, value, cache_key, shape; nil if not a group URI.
-- cache_key here is the static "identity" portion; the BIM patch
-- appends the actual first-N hashes for content-based invalidation.
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
    return group_by, value, group_by .. "_" .. hex .. "_" .. shape, shape
end

-- Pull a usable cover bb for a single child book during composition.
-- Tries (in order):
--   1. local file via the original BIM cache (already-cached only;
--      no extraction triggered)
--   2. cloud cover .png we previously downloaded
-- Returns nil if neither path produces one. Caller owns the bb.
function M.child_cover_bb(book, orig_getBookInfo, BIM)
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
    return cloud_covers.load_cover_bb(book.hash)
end

-- Compose up to N child covers into a mosaic and write the PNG to
-- disk. Returns the loaded composite as a fresh bb, or nil on total
-- failure (no usable child covers, or PNG write failure).
local function compose(books, dest_path, shape, orig_getBookInfo, BIM)
    if #books == 0 then return nil end
    local layout = M.LAYOUTS[shape] or M.LAYOUTS.grid
    local target_w, target_h = layout.target_w, layout.target_h
    local cols, rows = layout.cols, layout.rows
    local max_cells = cols * rows

    local Blitbuffer = require("ffi/blitbuffer")
    local target = Blitbuffer.new(target_w, target_h, Blitbuffer.TYPE_BBRGB32)
    target:fill(Blitbuffer.COLOR_WHITE)

    local gap = 8
    local cell_w = math.floor((target_w - (cols - 1) * gap) / cols)
    local cell_h = math.floor((target_h - (rows - 1) * gap) / rows)
    local placed = 0

    for i = 1, math.min(max_cells, #books) do
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

    local lfs = require("libs/libkoreader-lfs")
    local dir = group_covers_dir()
    if lfs.attributes(dir, "mode") ~= "directory" then lfs.mkdir(dir) end

    local ok_write = pcall(target.writeToFile, target, dest_path, "PNG")
    target:free()
    if not ok_write then
        logger.warn("ReadestLibrary group cover write failed: " .. tostring(dest_path))
        return nil
    end
    -- Re-load the file so the bb we hand back is one ImageWidget can
    -- safely take ownership of.
    local ok_render, RenderImage = pcall(require, "ui/renderimage")
    if not ok_render then return nil end
    local ok_load, bb = pcall(RenderImage.renderImageFile, RenderImage, dest_path, false)
    if not ok_load then return nil end
    return bb
end

-- Cells-per-mosaic for a given shape. Used by callers to know how many
-- books to fetch from the store.
function M.cells_for(shape)
    local layout = M.LAYOUTS[shape] or M.LAYOUTS.grid
    return layout.cols * layout.rows
end

-- High-level: query the store, derive a content-based cache key from
-- the actual first-N hashes, load from disk if present, else compose
-- fresh. Returns (bb, books) — books is the resolved list (so callers
-- can reuse it without a second query).
function M.serve_or_compose(group_by, value, cache_key, shape,
                            store, settings, orig_getBookInfo, BIM)
    if not store then return nil, {} end
    local n = M.cells_for(shape)
    local books = store:listBooksInGroup(group_by, value, n, {
        sort_by  = settings and settings.library_sort_by,
        sort_asc = settings and settings.library_sort_ascending == true,
    })
    -- Fingerprint: short prefix of each hash, joined. Stable for the
    -- same set in the same order; changes the moment any of those
    -- shifts.
    local parts = {}
    for i = 1, #books do
        parts[i] = (books[i].hash or ""):sub(1, 12)
    end
    local fingerprint = (#parts > 0) and table.concat(parts, "-") or "empty"
    local content_key = cache_key .. "_" .. fingerprint
    local cache_path = group_cover_path(content_key)

    local lfs = require("libs/libkoreader-lfs")
    if lfs.attributes(cache_path, "mode") == "file" then
        local ok, RenderImage = pcall(require, "ui/renderimage")
        if ok then
            local ok2, loaded = pcall(RenderImage.renderImageFile,
                                      RenderImage, cache_path, false)
            if ok2 then return loaded, books end
        end
    end
    return compose(books, cache_path, shape, orig_getBookInfo, BIM), books
end

return M
