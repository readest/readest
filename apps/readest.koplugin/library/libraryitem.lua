-- libraryitem.lua
-- Glue between LibraryStore rows and KOReader's MosaicMenuItem/ListMenuItem
-- rendering pipeline. The hard part is that cloud-only rows (in your
-- Readest cloud library but not on this device) don't have a real file
-- path. The trick we use:
--
--   * Each entry gets entry.file = "readest-cloud://<hash>" so the item
--     class doesn't classify the row as a directory (it checks for
--     entry.file/entry.path to distinguish files from folders).
--   * A permanent patch on BookInfoManager:getBookInfo intercepts that
--     URI scheme and returns a synthetic info table claiming
--     cover_fetched=true. Without this, MosaicMenuItem's
--     "info incomplete → schedule background extraction" path fires;
--     BIM forks a subprocess that crashes at bookinfomanager.lua:492
--     trying to lfs.attributes the cloud URI, and CoverMenu's poll loop
--     spins forever waiting for cache rows that will never appear.
--
-- v1 has no cloud-up/cloud-down badge overlay. The earlier OverlapGroup
-- wrap broke zen_ui's browser_cover_badges patch (it reads
-- target.dimen via self[1][1][1] and our wrapper shifted the chain by
-- one level, so its progress badges painted at screen-top instead of
-- cell-top). Re-implement in v1.1 by hooking paintTo() the same way zen
-- does, instead of replacing self[1].
--
-- Live-KOReader-only; no unit tests. Smoke-tested at LibraryWidget init.

local logger = require("logger")

local M = {}

-- Resolve apps/readest.koplugin root via debug.getinfo on this file's own
-- source path. Same trick zen_ui uses (plugin_root.lua); needed because
-- our bundled icons aren't in any of KOReader's ICONS_DIRS, so we have
-- to load them by absolute file path through ImageWidget instead of
-- IconWidget's name-based lookup.
local _plugin_root = (function()
    local src = debug.getinfo(1, "S").source or ""
    local path = (src:sub(1, 1) == "@")
        and src:sub(2):match("^(.*)/library/[^/]+$") or nil
    if path and path:sub(1, 1) ~= "/" then
        local ok, lfs = pcall(require, "libs/libkoreader-lfs")
        local cwd = ok and lfs and lfs.currentdir()
        if cwd then path = cwd .. "/" .. path end
    end
    return path
end)()
local _cloud_dl_icon_file = _plugin_root and (_plugin_root .. "/icons/cloud_download.svg")
local _cloud_up_icon_file = _plugin_root and (_plugin_root .. "/icons/cloud_upload.svg")

-- Sentinel field on entry tables: when true, the row represents a
-- cloud-only book. Currently only consulted by tap dispatch in
-- librarywidget; the rendering path uses the URI scheme on entry.file
-- since BIM is patched globally.
M.CLOUD_ONLY_FLAG = "_readest_cloud_only"
-- Set on entries for books that are on device but not in the cloud —
-- drives the "upload" icon overlay in list rows.
M.LOCAL_ONLY_FLAG = "_readest_local_only"

-- URI prefix used for cloud-only entry.file values. Anything starting
-- with this string is treated as a placeholder by patched BIM.
local CLOUD_URI_PREFIX = "readest-cloud://"
M.CLOUD_URI_PREFIX = CLOUD_URI_PREFIX

-- ---------------------------------------------------------------------------
-- Cover sharing: for any book identified by partial_md5 hash, prefer the
-- one-true cover regardless of whether it came from BIM (extracted from a
-- local file) or from a cover.png we downloaded out of Readest cloud.
--
--   Hybrid rows (cloud_present=1, local_present=1): the entry's file
--     points at the on-disk EPUB so BIM serves its own extracted cover
--     for both the cloud-side and local-side display. No extra work.
--
--   Cloud-only rows (cloud_present=1, local_present=0): there's no local
--     file for BIM to extract from. We cache a cover.png keyed by hash
--     under <settings>/readest_covers/<hash>.png; on first paint the
--     patched BIM either serves the cached PNG (loaded into a bb via
--     RenderImage) or kicks off an async download and returns no-cover
--     until the download completes — at which point we refresh the
--     Library widget so the cell repaints with the real cover.
-- ---------------------------------------------------------------------------
local _bim_patched = false
local _list_item_patched = false
local _orig_get_book_info = nil  -- captured pre-patch; reused by list-mode row builder

-- Tracks file_paths that came from our LibraryStore (= entries we render
-- in the Library widget). The BIM patch uses this to add _no_provider
-- on returned book info so ListMenuItem.update renders mandatory verbatim
-- (just the format, no trailing "  " from the standard "filetype  size"
-- format string), keeping right-side text right-aligned with cloud rows.
local _library_local_paths = {}
local _cover_pending  = {}    -- hash → true while a download is in flight
local _missing_covers = {}    -- hash → true after a 404 (don't keep retrying)
local _hash_meta      = {}    -- hash → { title, author } for synthetic FakeCover
local _visible_hashes = nil   -- set of hashes on the current Menu page; nil = no filter
local _refresh_pending = false  -- coalesces multiple cover-completion refreshes into one paint
-- Single-slot download queue: covers fetch one at a time so 9 visible
-- cells don't kick off 9 simultaneous synchronous socket.http calls
-- (which would freeze the UI for 9 × ~500ms in a row). Each download
-- yields to UIManager:nextTick before kicking off the next one, so the
-- UI gets to repaint and handle taps between fetches.
local _download_queue = {}    -- FIFO list of pending hashes
local _downloading    = false -- gate: only one socket.http active at a time
-- No in-memory bb cache: ImageWidget treats the bb we hand it as
-- disposable (imagewidget.lua:60, 120) and MosaicMenu doesn't override
-- that flag, so trying to share a single bb across paints leads to
-- use-after-scale / use-after-free corruption. PNG decode per visible
-- cell (≤14 per page) is the right trade-off — the OS file cache
-- absorbs repeated disk reads.

local function covers_dir()
    local DataStorage = require("datastorage")
    return DataStorage:getSettingsDir() .. "/readest_covers"
end

local function cover_path_for(hash)
    return covers_dir() .. "/" .. hash .. ".png"
end

-- Group cover composites: macOS-style folder previews with a 2x2 grid of
-- the first 4 child book covers. Cached on disk so we don't recompose
-- every paint. See compose_group_cover_inline for the inline generation
-- path; the cache is regenerated when the user runs Rescan or restarts.
local function group_covers_dir()
    local DataStorage = require("datastorage")
    return DataStorage:getSettingsDir() .. "/readest_group_covers"
end

local GROUP_URI_PREFIX = "readest-group://"
M.GROUP_URI_PREFIX = GROUP_URI_PREFIX
M.GROUP_FLAG = "_readest_group"

-- "Asimov" → "41 73 69 6d 6f 76" (sans spaces). Filesystem-safe regardless
-- of slashes/colons/etc. in the original group value.
local function hex_encode(s)
    return (s:gsub(".", function(c) return string.format("%02x", string.byte(c)) end))
end

local function hex_decode(hex)
    return (hex:gsub("..", function(h) return string.char(tonumber(h, 16)) end))
end

-- shape ∈ {"grid", "list"} — controls the composite layout (2x2 vs 1x4)
-- and is part of the cache key so a group has separate cached PNGs per
-- shape ∈ {"grid", "list"} — controls the composite layout (2x2 vs 1x4)
-- and is part of the cache key so a group has separate cached PNGs per
-- shape. Defaults to "grid" for backward compat with older callers.
local function build_group_uri(group_by, value, shape)
    return GROUP_URI_PREFIX .. group_by .. ":" .. hex_encode(value)
        .. ":" .. (shape or "grid") .. ".png"
end
M.build_group_uri = build_group_uri

-- Returns group_by, value, cache_key, shape. nil if the URI isn't a
-- group URI. cache_key here is just the static "identity" portion;
-- the BIM patch appends the actual first-N hashes so the on-disk PNG
-- auto-invalidates whenever those change.
local function parse_group_uri(uri)
    if uri:sub(1, #GROUP_URI_PREFIX) ~= GROUP_URI_PREFIX then return nil end
    local body = uri:sub(#GROUP_URI_PREFIX + 1)
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

-- Bump when the composite layout/dimensions change so existing on-disk
-- composites get regenerated on next paint instead of serving the old
-- aspect ratio forever. Defined here (before group_cover_path uses it)
-- because Lua locals are lexically scoped to references after declaration.
local CACHE_VERSION = 3

local function group_cover_path(cache_key)
    return group_covers_dir() .. "/" .. cache_key .. "_v" .. CACHE_VERSION .. ".png"
end

-- The URI is now "readest-cloud://<hash>.<ext>" — the .ext is needed so
-- listmenu's filemanagerutil.splitFileNameType returns a non-nil
-- filetype (listmenu.lua:316), otherwise the right-column composition
-- at line 324 crashes on string concat. Strip the extension here so
-- callers get the bare hash.
local function hash_from_uri(filepath)
    local rest = filepath:sub(#CLOUD_URI_PREFIX + 1)
    return (rest:match("^([^.]+)") or rest)
end

-- Load <hash>.png from disk into a fresh blitbuffer. Returns nil if the
-- file doesn't exist or fails to decode. Caller owns the bb (ImageWidget
-- will free it). No cache: see _bim_patched comment block above for why.
local function load_cover_bb(hash)
    local lfs = require("libs/libkoreader-lfs")
    local path = cover_path_for(hash)
    if lfs.attributes(path, "mode") ~= "file" then return nil end
    local ok, RenderImage = pcall(require, "ui/renderimage")
    if not ok then return nil end
    local ok2, bb = pcall(RenderImage.renderImageFile, RenderImage, path, false)
    if not ok2 or not bb then return nil end
    return bb
end

-- Kick off an async cloud cover download for `hash`. Idempotent against
-- in-flight requests and known-404 hashes. Only fires for hashes the
-- caller has marked as "currently visible" via M.set_visible_hashes —
-- otherwise BIM:getBookInfo calls from paint stragglers / poll loops
-- for off-screen items would queue up downloads the user can't see.
-- After a successful download, invalidates the cache slot (so the next
-- getBookInfo call decodes the new file) and refreshes the Library
-- widget to repaint visible cells.
-- Format "<hash8> <title>" for log lines so cover-download messages are
-- searchable by either identifier.
local function tag_for(hash)
    local meta = _hash_meta[hash] or {}
    return hash:sub(1, 8) .. " '" .. tostring(meta.title or "?") .. "'"
end

-- Find a usable cover bb for a single child book during group-cover
-- composition. Tries (in order):
--   1. local file via the original BIM cache (no extraction triggered;
--      already-cached covers only)
--   2. cloud cover .png we previously downloaded
-- Returns nil if neither path produces one. Caller owns the bb.
local function child_cover_bb(book, orig_getBookInfo, BIM)
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
    return load_cover_bb(book.hash)
end

-- Compose up to N child covers into a mosaic and write the PNG to disk.
-- Returns the loaded composite as a fresh bb, or nil on total failure
-- (no usable child covers, or PNG write failure). Synchronous; runs in
-- the BIM patch on first paint of a folder cell.
--
-- Two shapes:
--   "grid" — 2x2, target 360x480 (3:4 — typical book-cover aspect).
--   "list" — 2x2, target 480x480 (square — matches ListMenu's rigid
--   square cover slot, so the composite fills it vertically and each
--   mini-cover is visible at the same size as a single book's cover
--   slot would be at half scale, instead of getting squished into a
--   thin centered band as a 4-in-a-row strip would.)
--
-- Missing slots stay white — for 1 child, only one cell is filled;
-- folders look "filling up" as books accrue.
local LAYOUTS = {
    grid = { target_w = 360, target_h = 480, cols = 2, rows = 2 },
    list = { target_w = 480, target_h = 480, cols = 2, rows = 2 },
}

local function compose_group_cover(books, dest_path, shape, orig_getBookInfo, BIM)
    if #books == 0 then return nil end
    local layout = LAYOUTS[shape] or LAYOUTS.grid
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
        local cover = child_cover_bb(book, orig_getBookInfo, BIM)
        if cover then
            local row = math.floor((i - 1) / cols)
            local col = (i - 1) % cols
            local dx = col * (cell_w + gap)
            local dy = row * (cell_h + gap)
            -- :scale returns a fresh bb (new allocation); we own it,
            -- blit it, then free both the scaled and source bbs.
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

    -- Make sure the parent dir exists; first run of the plugin won't have
    -- it. Same idiom as covers_dir bootstrap below in patch_bim.
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
    -- safely take ownership of. (target was already freed above.)
    local ok_render, RenderImage = pcall(require, "ui/renderimage")
    if not ok_render then return nil end
    local ok_load, bb = pcall(RenderImage.renderImageFile, RenderImage, dest_path, false)
    if not ok_load then return nil end
    return bb
end

-- ---------------------------------------------------------------------------
-- List-mode group row builder
-- ---------------------------------------------------------------------------
-- ListMenu's cover slot is hard-coded to a square dimen.h × dimen.h. To
-- show 4 mini-covers each at that same square size (so each "cell" is
-- the same size as a single book row's cover), we replace the row's
-- widget tree wholesale. Mirrors the same widget structure the original
-- ListMenuItem.update builds (UnderlineContainer → VerticalGroup{
-- VerticalSpan, HorizontalGroup{cover-area, title, count}}), but with
-- the cover-area widened from 1× row-height to 4× row-height.
--
-- Returns nothing; mutates self._underline_container directly.
local function build_group_list_widget(self)
    local Geom            = require("ui/geometry")
    local Size            = require("ui/size")
    local Font            = require("ui/font")
    local HorizontalGroup = require("ui/widget/horizontalgroup")
    local HorizontalSpan  = require("ui/widget/horizontalspan")
    local VerticalGroup   = require("ui/widget/verticalgroup")
    local VerticalSpan    = require("ui/widget/verticalspan")
    local CenterContainer = require("ui/widget/container/centercontainer")
    local LeftContainer   = require("ui/widget/container/leftcontainer")
    local FrameContainer  = require("ui/widget/container/framecontainer")
    local TextWidget      = require("ui/widget/textwidget")
    local TextBoxWidget   = require("ui/widget/textboxwidget")
    local ImageWidget     = require("ui/widget/imagewidget")
    local BookInfoManager = require("bookinfomanager")

    local entry = self.entry
    local underline_h = self.underline_h or 1
    local dimen_h = self.height - 2 * underline_h
    local dimen_w = self.width

    -- Each mini-cover gets a thin border (no padding) matching the
    -- single-book cover treatment in ListMenuItem.update (see
    -- coverbrowser/listmenu.lua:258-269). cell_h subtracts the border
    -- both sides so the framed cell fits within the row height.
    local border_size = Size.border.thin
    local cell_h = dimen_h - 2 * border_size
    local cell_w = cell_h  -- each mini = single book cover slot
    local n_cells = 4
    local gap = math.floor(Size.padding.small / 2)

    -- Resolve children. Pass current sort_by + sort_asc so the strip
    -- shows the same first-N books the user would see when drilling in.
    local LibraryWidget = package.loaded["library.librarywidget"]
    local store = LibraryWidget and LibraryWidget._store
    local group  = entry._readest_group
    local settings = M._opts and M._opts.settings or {}
    local books  = (store and group)
        and store:listBooksInGroup(group._group_by, group.name, n_cells, {
            sort_by  = settings.library_sort_by,
            sort_asc = settings.library_sort_ascending == true,
        }) or {}

    -- Slot width fixed per cell so all rows align; the framed cover
    -- inside is sized to its rendered dimensions (image_size + border)
    -- so the border hugs the cover with no internal padding — same
    -- pattern as a single-book row in coverbrowser/listmenu.lua:258-269.
    local slot_w = cell_w + 2 * border_size
    local slot_h = cell_h + 2 * border_size
    local BIM = package.loaded["bookinfomanager"]
    local strip_children = {}
    for i = 1, n_cells do
        if i > 1 then
            strip_children[#strip_children + 1] = HorizontalSpan:new{ width = gap }
        end
        local book = books[i]
        local cell_widget
        if book then
            local cover = child_cover_bb(book, _orig_get_book_info, BIM)
            if cover then
                -- Precompute scale_factor and pass it WITHOUT width/height
                -- so ImageWidget:getSize returns the actual scaled bb
                -- dimensions (with explicit width+height it always returns
                -- those exact dims, which would re-introduce padding inside
                -- the frame).
                local cw, ch = cover:getWidth(), cover:getHeight()
                local _, _, scale_factor = BookInfoManager.getCachedCoverSize(
                    cw, ch, cell_w, cell_h)
                local wimage = ImageWidget:new{
                    image = cover,
                    scale_factor = scale_factor,
                }
                wimage:_render()
                local image_size = wimage:getSize()
                cell_widget = CenterContainer:new{
                    dimen = Geom:new{ w = slot_w, h = slot_h },
                    FrameContainer:new{
                        width  = image_size.w + 2 * border_size,
                        height = image_size.h + 2 * border_size,
                        margin = 0, padding = 0,
                        bordersize = border_size,
                        wimage,
                    },
                }
            end
        end
        if not cell_widget then
            -- Empty slot keeps strip width consistent; no border so
            -- it visually disappears (like a missing book).
            cell_widget = HorizontalSpan:new{ width = slot_w }
        end
        strip_children[#strip_children + 1] = cell_widget
    end

    local strip_widget = HorizontalGroup:new(strip_children)
    local strip_w = slot_w * n_cells + gap * (n_cells - 1)

    -- Right side: count
    local count_widget = TextWidget:new{
        text = entry.mandatory or "",
        face = Font:getFace("infont", 16),
    }
    local count_w = count_widget:getSize().w
    local pad_after_strip = Size.padding.large
    local pad_right = Size.padding.large

    -- Title fills whatever's left
    local title_w = math.max(0, dimen_w - strip_w - pad_after_strip - count_w - pad_right)
    local title_widget = TextBoxWidget:new{
        text = entry.text or "",
        face = Font:getFace("smalltfont", 18),
        width = title_w,
        bold = true,
    }

    -- Wrap in LeftContainer with explicit dimen — ListMenuItem:paintTo
    -- reads self[1][1][2].dimen for shortcut/dogear overlay positioning.
    -- A bare HorizontalGroup never sets `dimen` so the access crashes.
    local widget = LeftContainer:new{
        dimen = Geom:new{ w = dimen_w, h = dimen_h },
        HorizontalGroup:new{
            align = "center",
            strip_widget,
            HorizontalSpan:new{ width = pad_after_strip },
            CenterContainer:new{
                dimen = Geom:new{ w = title_w, h = dimen_h },
                title_widget,
            },
            CenterContainer:new{
                dimen = Geom:new{ w = count_w, h = dimen_h },
                count_widget,
            },
            HorizontalSpan:new{ width = pad_right },
        },
    }

    if self._underline_container[1] then
        self._underline_container[1]:free()
    end
    self._underline_container[1] = VerticalGroup:new{
        VerticalSpan:new{ width = underline_h },
        widget,
    }
    -- Tell ListMenu's _updateItemsBuildUI not to queue this item for BIM
    -- background extraction (which would fork a subprocess to scrape
    -- metadata from a file that doesn't actually exist on disk).
    self.bookinfo_found = true
end

-- Cached cloud-download IconWidget — single instance reused across all
-- cloud-row paints (IconWidget loads + caches its bb on first render).
-- Sized once based on screen DPI; rebuilt if size_loaded changes (which
-- it currently doesn't but the indirection keeps room for orientation
-- swaps later).
-- Per-icon cache: {key → {widget, size_loaded}}. Key is a stable token
-- ("dl" / "up"); IconWidget loads + caches its bb on first render so we
-- only pay the SVG decode once per icon size.
local _icon_cache = {}

local function get_overlay_icon(file, key, target_size)
    local entry = _icon_cache[key]
    if entry and entry.size_loaded == target_size then
        return entry.widget
    end
    if entry and entry.widget then
        local prev = entry.widget
        entry.widget = nil
        pcall(function() prev:free() end)
    end
    if not file then return nil end
    local ok, ImageWidget = pcall(require, "ui/widget/imagewidget")
    if not ok then return nil end
    local widget = ImageWidget:new{
        file = file,
        width = target_size,
        height = target_size,
        scale_factor = 0,  -- aspect-preserving fit
        alpha = true,      -- preserve SVG transparency
        is_icon = true,
    }
    _icon_cache[key] = { widget = widget, size_loaded = target_size }
    return widget
end

-- Paint the cloud-download icon at the right edge of the row, in the
-- vertical slot where ListMenuItem normally draws its second line of
-- right-side text (wpageinfo, eg "1% of 1424 pages"). For row height
-- dimen.h, the standard wright VerticalGroup is roughly:
--   VerticalSpan(2) + fileinfo(~h*0.28) + pageinfo(~h*0.28)
-- center-aligned, which lands pageinfo at ~y + 0.5*h. Mirroring that
-- keeps the format label and the cloud icon visually stacked at the
-- right edge with consistent padding.
-- icon_key: "dl" for cloud-download (cloud-only books) or "up" for
-- cloud-upload (local-only books). Both render at the same right-edge
-- slot below the format label.
local function paint_cloud_icon_overlay(item, bb, x, y, icon_key)
    local Screen = require("device").screen
    local icon_size = math.floor(item.height * 0.28)
    local file = (icon_key == "up") and _cloud_up_icon_file or _cloud_dl_icon_file
    local icon = get_overlay_icon(file, icon_key, icon_size)
    if not icon then return end
    -- _render so getSize returns the actual scaled dims, not the
    -- requested width/height. Same caveat as the group-row composer.
    icon:_render()
    local s = icon:getSize()
    local pad_right = Screen:scaleBySize(10)
    local icon_x = x + item.width - pad_right - s.w
    local icon_y = y + math.floor(item.height * 0.5)
    icon:paintTo(bb, icon_x, icon_y)
end

-- Locate listmenu's local ListMenuItem class via its captured upvalue
-- on the exported _updateItemsBuildUI mixin. ListMenuItem isn't exported
-- directly, but its only use site is _updateItemsBuildUI's closure, so
-- debug.getupvalue is the cheapest path that doesn't require modifying
-- coverbrowser.koplugin or copy-pasting the ~50-line build loop.
local function patch_list_menu_item()
    if _list_item_patched then return end
    local debug = require("debug")
    local ok, ListMenu = pcall(require, "listmenu")
    if not ok or type(ListMenu._updateItemsBuildUI) ~= "function" then return end
    local ListMenuItem
    for i = 1, 50 do
        local name, val = debug.getupvalue(ListMenu._updateItemsBuildUI, i)
        if not name then break end
        if name == "ListMenuItem" and type(val) == "table" then
            ListMenuItem = val
            break
        end
    end
    if not ListMenuItem or type(ListMenuItem.update) ~= "function" then
        logger.warn("ReadestLibrary: couldn't locate ListMenuItem class for patching")
        return
    end
    local orig_update = ListMenuItem.update
    function ListMenuItem:update()
        if self.entry and self.entry._readest_group then
            return build_group_list_widget(self)
        end
        return orig_update(self)
    end

    -- Overlay a cloud icon at the right edge, just below the format text:
    --   cloud-only (cloud_present=1, local_present=0) → download icon
    --   local-only (cloud_present=0, local_present=1) → upload icon
    -- Painted in paintTo (after the regular widget tree) so we don't
    -- have to thread a custom IconWidget through ListMenuItem.update's
    -- 600-line widget builder.
    local orig_paint = ListMenuItem.paintTo
    function ListMenuItem:paintTo(bb, x, y)
        orig_paint(self, bb, x, y)
        if not self.entry then return end
        if self.entry[M.CLOUD_ONLY_FLAG] and _cloud_dl_icon_file then
            paint_cloud_icon_overlay(self, bb, x, y, "dl")
        elseif self.entry[M.LOCAL_ONLY_FLAG] and _cloud_up_icon_file then
            paint_cloud_icon_overlay(self, bb, x, y, "up")
        end
    end
    _list_item_patched = true
    logger.info("ReadestLibrary: patched ListMenuItem update + paintTo")
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
            -- Could happen if a 404 was recorded between enqueue and now
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
            sync_auth  = M._opts.sync_auth,
            sync_path  = M._opts.sync_path,
            settings   = M._opts.settings,
            covers_dir = covers_dir(),
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
                -- tick (the queue's normal cadence between downloads)
                -- still get one repaint, not N flickering redraws.
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
            -- Yield to the UI loop before pumping the next one — gives
            -- the user a chance to flip pages / tap buttons between
            -- the brief synchronous socket.http freezes.
            local UIManager = require("ui/uimanager")
            UIManager:nextTick(process_queue)
        end)
end

local function trigger_cover_download(hash)
    if _cover_pending[hash] then
        logger.dbg("ReadestLibrary cover skip: " .. tag_for(hash) .. " already in flight")
        return
    end
    if _missing_covers[hash] then
        logger.dbg("ReadestLibrary cover skip: " .. tag_for(hash) .. " known 404")
        return
    end
    if not M._opts or not M._opts.sync_auth then
        logger.warn("ReadestLibrary cover skip: " .. tag_for(hash)
            .. " — libraryitem.install not called yet")
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

-- ---------------------------------------------------------------------------
-- patch_bim: install a permanent intercept on BookInfoManager:getBookInfo
-- for readest-cloud:// URIs. Idempotent; subsequent calls no-op.
--
-- Returning has_meta=true + cover_fetched=true short-circuits
-- MosaicMenuItem/ListMenuItem's incomplete-info branch
-- (mosaicmenu.lua:495-499 / listmenu equivalent), so cloud entries never
-- enter the items_to_update list and the BIM subprocess never gets
-- called for them. When a cached cover.png is available, also fills in
-- has_cover/cover_bb/cover_w/cover_h so the original render path draws
-- the real cover instead of FakeCover.
-- ---------------------------------------------------------------------------
function M.install(opts)
    M._opts = opts or {}
    logger.info("ReadestLibrary libraryitem.install: opts="
        .. (opts and "set" or "nil")
        .. " sync_auth=" .. tostring(opts and opts.sync_auth ~= nil)
        .. " bim_patched_before=" .. tostring(_bim_patched))
    -- Patch ListMenuItem.update so list-mode group rows get our wider
    -- cover strip. Idempotent; safe to call repeatedly.
    patch_list_menu_item()
    if _bim_patched then return end
    local ok, BIM = pcall(require, "bookinfomanager")
    if not ok or not BIM then
        logger.warn("ReadestLibrary libraryitem: bookinfomanager not available")
        return
    end
    _bim_patched = true

    local orig_getBookInfo = BIM.getBookInfo
    _orig_get_book_info = orig_getBookInfo  -- module-level for the list-mode row builder
    function BIM:getBookInfo(filepath, do_cover_image)
        if type(filepath) == "string"
            and filepath:sub(1, #CLOUD_URI_PREFIX) == CLOUD_URI_PREFIX then
            local hash = hash_from_uri(filepath)
            local meta = _hash_meta[hash] or {}
            local info = {
                has_meta      = true,
                cover_fetched = true,
                ignore_cover  = false,
                title         = meta.title,
                authors       = meta.author,
                has_cover     = false,
                -- Tells ListMenuItem.update to render mandatory verbatim
                -- (= the format string) rather than prefixing it with
                -- the synthetic "PNG" filetype derived from the URI.
                _no_provider  = true,
            }
            if do_cover_image then
                local bb = load_cover_bb(hash)
                if bb then
                    local w, h = bb:getWidth(), bb:getHeight()
                    info.cover_bb      = bb  -- ImageWidget owns + frees
                    info.cover_w       = w
                    info.cover_h       = h
                    -- BookInfoManager.isCachedCoverInvalid (bookinfomanager.lua:1017)
                    -- crashes if cover_sizetag is nil. The format is
                    -- "<original_w>x<original_h>"; since we serve the raw
                    -- PNG as cover_bb (no pre-scaling), the bb's own
                    -- dimensions ARE the original.
                    info.cover_sizetag = w .. "x" .. h
                    info.has_cover     = true
                else
                    -- Lazy on-demand fetch: only the cells whose covers
                    -- the user has actually scrolled into view try to
                    -- download. Eager-trigger-on-every-paint would queue
                    -- 1200+ Spore RPCs on first Library open and saturate
                    -- the device.
                    trigger_cover_download(hash)
                end
            end
            return info
        end

        -- Group folder URI: serve a 2x2 mosaic of the first 4 child book
        -- covers (or fewer; missing slots stay white). Cached on disk so
        -- subsequent paints are a single PNG load. Composition runs
        -- inline because the group's children may be intermixed local +
        -- cloud books and the cover sources are already on disk by the
        -- time the user has browsed enough to have a folder full of them.
        if type(filepath) == "string"
            and filepath:sub(1, #GROUP_URI_PREFIX) == GROUP_URI_PREFIX then
            local group_by, value, cache_key, shape = parse_group_uri(filepath)
            local meta = _hash_meta[filepath] or {}
            local info = {
                has_meta      = true,
                cover_fetched = true,
                ignore_cover  = false,
                title         = meta.title,
                authors       = meta.author,
                has_cover     = false,
                -- _no_provider keeps ListMenuItem's right-side string
                -- short — it skips the "PNG" filetype + page count and
                -- just shows self.mandatory (= the child count).
                _no_provider  = true,
            }
            if do_cover_image and group_by and value and cache_key then
                -- Cache key strategy: include the actual first-N hashes
                -- so the on-disk PNG auto-invalidates whenever the
                -- composition's content changes (sort flip, book added
                -- to group, book bumped to top, etc). We HAVE to query
                -- the store every paint to know the current first-N
                -- hashes — that's cheap (indexed) and the alternative
                -- (no cache) re-renders the PNG too. Cache hit avoids
                -- the per-cover blitbuffer scale + composite path.
                local LibraryWidget = package.loaded["library.librarywidget"]
                local store = LibraryWidget and LibraryWidget._store
                local settings = M._opts and M._opts.settings or {}
                local bb
                if store then
                    local n = (LAYOUTS[shape] or LAYOUTS.grid).cols
                            * (LAYOUTS[shape] or LAYOUTS.grid).rows
                    local books = store:listBooksInGroup(group_by, value, n, {
                        sort_by  = settings.library_sort_by,
                        sort_asc = settings.library_sort_ascending == true,
                    })
                    -- Fingerprint: short prefix of each hash, joined.
                    -- Stable for the same set of books in the same
                    -- order; changes the moment the order or any hash
                    -- in the first-N changes.
                    local parts = {}
                    for i = 1, #books do
                        parts[i] = (books[i].hash or ""):sub(1, 12)
                    end
                    local fingerprint = (#parts > 0) and table.concat(parts, "-")
                                                     or "empty"
                    local content_key = cache_key .. "_" .. fingerprint
                    local cache_path = group_cover_path(content_key)
                    local lfs = require("libs/libkoreader-lfs")
                    if lfs.attributes(cache_path, "mode") == "file" then
                        local ok, RenderImage = pcall(require, "ui/renderimage")
                        if ok then
                            local ok2, loaded = pcall(RenderImage.renderImageFile,
                                                      RenderImage, cache_path, false)
                            if ok2 then bb = loaded end
                        end
                    end
                    if not bb then
                        bb = compose_group_cover(books, cache_path, shape,
                                                 orig_getBookInfo, BIM)
                    end
                end
                if bb then
                    local w, h = bb:getWidth(), bb:getHeight()
                    info.cover_bb      = bb
                    info.cover_w       = w
                    info.cover_h       = h
                    info.cover_sizetag = w .. "x" .. h
                    info.has_cover     = true
                end
            end
            return info
        end

        -- Real local file: get the standard BIM info, then add
        -- _no_provider for paths that came from our LibraryStore so the
        -- right-side text right-aligns with cloud rows (see comment on
        -- _library_local_paths). Make a shallow copy first so we don't
        -- mutate BIM's cached entry.
        local result = orig_getBookInfo(self, filepath, do_cover_image)
        if result and type(filepath) == "string" and _library_local_paths[filepath] then
            local copy = {}
            for k, v in pairs(result) do copy[k] = v end
            copy._no_provider = true
            return copy
        end
        return result
    end
end

-- ---------------------------------------------------------------------------
-- set_visible_hashes(menu) — record which cloud-only hashes are on the
-- current Menu page so trigger_cover_download can reject downloads for
-- everything else. Called by librarywidget on every page change /
-- updateItems. Pass nil to disable the filter (e.g. when the Library is
-- closed and the patched BIM might still be invoked from elsewhere).
-- ---------------------------------------------------------------------------
function M.set_visible_hashes(menu)
    if not menu then
        logger.dbg("ReadestLibrary set_visible_hashes: cleared (menu nil)")
        _visible_hashes = nil
        return
    end
    local set = {}
    local count = 0
    local page    = menu.page or 1
    local perpage = menu.perpage or 1
    local items   = menu.item_table or {}
    local first   = (page - 1) * perpage + 1
    local last    = math.min(first + perpage - 1, #items)
    for i = first, last do
        local entry = items[i]
        if entry and entry[M.CLOUD_ONLY_FLAG] and type(entry.file) == "string" then
            local hash = hash_from_uri(entry.file)
            set[hash] = true
            count = count + 1
        end
    end
    _visible_hashes = set
    logger.info("ReadestLibrary set_visible_hashes: page=" .. page
        .. " range=" .. first .. ".." .. last
        .. " cloud_only_visible=" .. count
        .. " (item_table size=" .. #items .. ")")
end

-- ---------------------------------------------------------------------------
-- entry_from_row: convert a LibraryStore row into a Menu item_table entry.
-- The Menu item layer expects entry.file, entry.text, entry.is_file etc.
-- _readest_row is preserved so the tap handler in librarywidget can
-- dispatch on cloud_present / local_present without re-querying the store.
-- ---------------------------------------------------------------------------
-- Group entry. Two render modes are supported:
--   - When opts.group_by is provided AND opts.with_cover ~= false, we
--     give the entry a readest-group:// URI so MosaicMenuItem treats it
--     as a "file" and routes the cell paint through the patched BIM,
--     which serves a 2x2 mosaic of the first 4 child book covers
--     (macOS folder-style preview).
--   - Otherwise (e.g. List mode where the cover preview adds little) the
--     entry has no `file` field, so MosaicMenuItem/ListMenuItem render
--     the default folder treatment (rounded frame + count badge).
--
-- _readest_group carries the full path so the tap dispatch can drill in.
function M.entry_from_group(group, opts)
    opts = opts or {}
    local entry = {
        text           = group.display_name or group.name,
        mandatory      = tostring(group.count or 0),
        _readest_group = group,
    }
    -- Stash group_by on the group descriptor itself so renderers (the
    -- list-mode row builder in particular) can resolve children without
    -- re-parsing the URI.
    if opts.group_by then group._group_by = opts.group_by end
    if opts.group_by and opts.with_cover ~= false then
        local shape = opts.shape or "grid"
        local uri = build_group_uri(opts.group_by, group.name, shape)
        entry.file = uri
        entry.is_file = true
        -- Stash by URI so the BIM patch can return the title/authors
        -- when MosaicMenuItem queries getBookInfo for this synthetic
        -- "file" — without this the cell would render with a blank
        -- FakeCover when no composite is cached yet on first paint.
        _hash_meta[uri] = {
            title = group.display_name or group.name,
        }
    end
    return entry
end

-- "Up one level" entry. _readest_back_to is the parent path to navigate
-- to (nil = back to root); the boolean flag distinguishes a root-back
-- entry from a regular row that just happens to lack a back path.
function M.entry_back(parent_path, label)
    return {
        text             = label,
        mandatory        = "",
        _readest_is_back = true,
        _readest_back_to = parent_path,
    }
end

function M.entry_from_row(row, opts)
    if not row then return nil end
    -- mandatory is required by ListMenuItem (listmenu.lua:319, 324) for
    -- the right-column file size / "Cloud" hint. Without it, BD.wrap(nil)
    -- short-circuits to nil and the surrounding string concat crashes.
    -- Use file size if we ever store one (we don't yet), else "Cloud" for
    -- cloud-only entries and "" for local entries.
    local entry = {
        text         = row.title,
        author       = row.author,
        series       = row.series,
        series_index = row.series_index,
        cover_path   = row.cover_path,
        is_file      = true,
        mandatory    = "",
    }
    local EXTS = require("library.exts")
    local ext = (EXTS[row.format] or "epub")
    if row.local_present == 1 and row.file_path then
        entry.file = row.file_path
        -- Same right-side treatment as cloud entries: BIM patch tags
        -- this path with _no_provider so ListMenuItem.update renders
        -- mandatory verbatim (= the format) without the trailing
        -- "<filetype>  " padding the standard format-string would add
        -- when our mandatory is short. Without this, local rows had
        -- "epub  " (with trailing whitespace) and didn't right-align
        -- with cloud rows that used just "epub".
        entry.mandatory = ext
        _library_local_paths[row.file_path] = true
        -- Mark "local but not in cloud" so ListMenuItem's paintTo patch
        -- overlays the cloud-upload icon (mirroring Readest's BookItem
        -- icon rule: !uploadedAt → cloud-up).
        if (row.cloud_present or 0) == 0 then
            entry[M.LOCAL_ONLY_FLAG] = true
        end
    else
        -- Encode the real extension into the URI so listmenu's
        -- splitFileNameType returns a non-nil filetype for the right
        -- column. The patched BIM strips it back off.
        entry.file = CLOUD_URI_PREFIX .. row.hash .. "." .. ext
        entry[M.CLOUD_ONLY_FLAG] = true
        -- mandatory shows on the row's right side. We put just the
        -- format here; the BIM patch sets _no_provider=true so
        -- ListMenuItem renders this verbatim (no "PNG  " prefix), and
        -- the ListMenuItem.paintTo patch overlays a cloud-download
        -- icon below the format text.
        entry.mandatory = ext
        -- Cache title/author by hash so the patched BIM (which is keyed
        -- by URI/path, not by row) can return them for FakeCover. Without
        -- this MosaicMenuItem ends up calling FakeCover with title=nil,
        -- authors=nil, and only the entry.text fallback path renders —
        -- which on some grid layouts produces an effectively-empty cell.
        _hash_meta[row.hash] = {
            title  = row.title,
            author = row.author,
        }
    end
    entry._readest_row = row
    return entry
end

return M
