-- bim_patch.lua
-- Two global monkey-patches that make our cloud-only / group entries
-- coexist with KOReader's coverbrowser pipeline:
--
--   1. BookInfoManager:getBookInfo — intercepts readest-cloud:// and
--      readest-group:// URIs. Without this, MosaicMenuItem's
--      "info incomplete → schedule background extraction" path fires;
--      BIM forks a subprocess that crashes at bookinfomanager.lua:492
--      trying to lfs.attributes the synthetic URI.
--
--   2. ListMenuItem:update + paintTo — list-mode group rows use a
--      custom widget tree (4-cell cover strip), and book rows get a
--      cloud-up/cloud-down icon overlay below the format text.
--
-- ListMenuItem is `local` to coverbrowser/listmenu.lua, so we reach
-- it via debug.getupvalue on the exported _updateItemsBuildUI mixin.

local logger = require("logger")
local cloud_covers = require("library.cloud_covers")
local group_covers = require("library.group_covers")
local cloud_icons  = require("library.cloud_icons")
local list_strip   = require("library.list_strip")

local M = {}

local _bim_patched = false
local _list_item_patched = false
local _orig_get_book_info = nil  -- captured pre-patch; needed by list_strip

-- Tracks file_paths that came from our LibraryStore (= entries we
-- render in the Library widget). The BIM patch tags returned info
-- with _no_provider so ListMenuItem.update renders mandatory verbatim
-- (the format string), keeping right-side text right-aligned with
-- cloud rows that already use _no_provider.
local _library_local_paths = {}

-- Sentinel used by entry_from_row to flag cloud-only rows. Re-exported
-- here so the patches can read it without a circular libraryitem import.
M.CLOUD_ONLY_FLAG = "_readest_cloud_only"
M.LOCAL_ONLY_FLAG = "_readest_local_only"

function M.register_local_path(path)
    _library_local_paths[path] = true
end

function M.orig_get_book_info()
    return _orig_get_book_info
end

-- Patch BIM:getBookInfo with a router that dispatches on URI prefix.
-- Idempotent.
local function patch_bim(opts)
    if _bim_patched then return end
    local ok, BIM = pcall(require, "bookinfomanager")
    if not ok or not BIM then
        logger.warn("ReadestLibrary bim_patch: bookinfomanager not available")
        return
    end
    _bim_patched = true
    _orig_get_book_info = BIM.getBookInfo

    local function build_cloud_info(filepath, do_cover_image)
        local hash = cloud_covers.hash_from_uri(filepath)
        local meta = cloud_covers.get_meta(hash)
        local info = {
            has_meta      = true,
            cover_fetched = true,
            ignore_cover  = false,
            title         = meta.title,
            authors       = meta.author,
            has_cover     = false,
            -- Render mandatory verbatim (no "<filetype>  size" prefix).
            _no_provider  = true,
        }
        if do_cover_image then
            local bb = cloud_covers.load_cover_bb(hash)
            if bb then
                local w, h = bb:getWidth(), bb:getHeight()
                info.cover_bb      = bb
                info.cover_w       = w
                info.cover_h       = h
                -- BookInfoManager.isCachedCoverInvalid (bookinfomanager.lua:1017)
                -- crashes if cover_sizetag is nil. Format is "<w>x<h>".
                info.cover_sizetag = w .. "x" .. h
                info.has_cover     = true
            else
                -- Lazy fetch: only currently-visible cells trigger.
                cloud_covers.trigger_download(hash)
            end
        end
        return info
    end

    local function build_group_info(filepath, do_cover_image)
        local group_by, value, shape = group_covers.parse_uri(filepath)
        local meta = cloud_covers.get_meta(filepath)
        local info = {
            has_meta      = true,
            cover_fetched = true,
            ignore_cover  = false,
            title         = meta.title,
            authors       = meta.author,
            has_cover     = false,
            _no_provider  = true,
        }
        if do_cover_image and group_by and value then
            local LibraryWidget = package.loaded["library.librarywidget"]
            local store = LibraryWidget and LibraryWidget._store
            local settings = M._opts and M._opts.settings or {}
            local bb = group_covers.serve_or_compose(
                group_by, value, shape,
                store, settings, _orig_get_book_info, BIM)
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

    function BIM:getBookInfo(filepath, do_cover_image)
        if type(filepath) == "string" then
            if filepath:sub(1, #cloud_covers.URI_PREFIX) == cloud_covers.URI_PREFIX then
                return build_cloud_info(filepath, do_cover_image)
            end
            if filepath:sub(1, #group_covers.URI_PREFIX) == group_covers.URI_PREFIX then
                return build_group_info(filepath, do_cover_image)
            end
        end
        -- Real local file: forward to the original BIM, then add
        -- _no_provider for paths that came from our LibraryStore so
        -- the right-side text right-aligns with cloud rows. Shallow
        -- copy first so we don't mutate BIM's cached entry.
        local result = _orig_get_book_info(self, filepath, do_cover_image)
        if result and type(filepath) == "string" and _library_local_paths[filepath] then
            local copy = {}
            for k, v in pairs(result) do copy[k] = v end
            copy._no_provider = true
            return copy
        end
        return result
    end
end

-- Locate listmenu's local ListMenuItem class via its captured upvalue
-- on the exported _updateItemsBuildUI mixin. Cheapest path that
-- doesn't require modifying coverbrowser.koplugin or copy-pasting the
-- ~50-line build loop.
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

    -- Custom group-row widget tree (wider cover strip).
    local orig_update = ListMenuItem.update
    function ListMenuItem:update()
        if self.entry and self.entry._readest_group then
            local LibraryWidget = package.loaded["library.librarywidget"]
            return list_strip.build(self, {
                store              = LibraryWidget and LibraryWidget._store,
                settings           = M._opts and M._opts.settings,
                orig_getBookInfo   = _orig_get_book_info,
            })
        end
        return orig_update(self)
    end

    -- Cloud icon overlay painted on top of the standard widget tree.
    --   cloud-only (cloud_present=1, local_present=0) → download icon
    --   local-only (cloud_present=0, local_present=1) → upload icon
    local orig_paint = ListMenuItem.paintTo
    function ListMenuItem:paintTo(bb, x, y)
        orig_paint(self, bb, x, y)
        if not self.entry then return end
        if self.entry[M.CLOUD_ONLY_FLAG] and cloud_icons.has_icon("dl") then
            cloud_icons.paint(self, bb, x, y, "dl")
        elseif self.entry[M.LOCAL_ONLY_FLAG] and cloud_icons.has_icon("up") then
            cloud_icons.paint(self, bb, x, y, "up")
        end
    end
    _list_item_patched = true
    logger.info("ReadestLibrary: patched ListMenuItem update + paintTo")
end

function M.install(opts)
    M._opts = opts or {}
    cloud_covers.set_opts(M._opts)
    logger.info("ReadestLibrary bim_patch.install: opts="
        .. (opts and "set" or "nil")
        .. " sync_auth=" .. tostring(opts and opts.sync_auth ~= nil)
        .. " bim_patched_before=" .. tostring(_bim_patched))
    -- Both patches are idempotent so the order + repeated calls are
    -- safe. ListMenuItem first since it doesn't need BIM.
    patch_list_menu_item()
    patch_bim()
end

return M
