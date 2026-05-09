-- libraryitem.lua
-- Maps LibraryStore rows (and group descriptors) into Menu entry
-- tables that MosaicMenuItem / ListMenuItem can render. The heavy
-- lifting is in:
--
--   library.cloud_covers — single-book cloud cover lifecycle
--   library.group_covers — folder-preview composite mosaics
--   library.cloud_icons  — cloud-up/down overlay icons
--   library.list_strip   — list-mode group row widget
--   library.bim_patch    — BookInfoManager + ListMenuItem patches
--
-- This module is a thin glue layer that produces entries shaped the
-- way the rendering pipeline expects, then delegates lifecycle hooks
-- (install, set_visible_hashes) to the right submodule.

local logger       = require("logger")
local cloud_covers = require("library.cloud_covers")
local group_covers = require("library.group_covers")
local bim_patch    = require("library.bim_patch")

local M = {}

-- Sentinel fields on entry tables. Tap dispatch in librarywidget reads
-- them; the bim_patch list-row patches read them via M.<flag>.
M.CLOUD_ONLY_FLAG = bim_patch.CLOUD_ONLY_FLAG
M.LOCAL_ONLY_FLAG = bim_patch.LOCAL_ONLY_FLAG

-- ---------------------------------------------------------------------------
-- Lifecycle delegates
-- ---------------------------------------------------------------------------

-- Called once when the Library widget opens. Wires the patched BIM
-- with the user's current sync_auth/path/settings.
function M.install(opts)
    bim_patch.install(opts)
end

-- Limit cloud-cover downloads to hashes the current page actually needs.
-- Two contributors:
--   * cloud-only book entries — their own hash (cover painted directly)
--   * group entries — the first-N children's hashes (cover painted as a
--     2x2/1x4 mosaic in build_group_info; up to 4 child .png downloads
--     get queued the first time the group is on screen).
-- Without the group expansion, group cells render as FakeCover until the
-- user drills into each group individually, since trigger_download's
-- visibility filter would reject the children.
function M.set_visible_hashes(menu)
    if not menu then
        cloud_covers.set_visible_hashes(nil)
        return
    end

    local LibraryWidget = package.loaded["library.librarywidget"]
    local store = LibraryWidget and LibraryWidget._store
    local settings = (bim_patch._opts and bim_patch._opts.settings) or {}
    local view_mode = (settings.library_view_mode == "list") and "list" or "mosaic"
    local shape = (view_mode == "list") and "list" or "grid"
    local n_cells = group_covers.cells_for(shape)
    local sort_opts = {
        sort_by  = settings.library_sort_by,
        sort_asc = settings.library_sort_ascending == true,
    }

    local set = {}
    local page    = menu.page or 1
    local perpage = menu.perpage or 1
    local items   = menu.item_table or {}
    local first   = (page - 1) * perpage + 1
    local last    = math.min(first + perpage - 1, #items)
    local cloud_only_count, group_child_count = 0, 0
    for i = first, last do
        local entry = items[i]
        if entry then
            if entry[M.CLOUD_ONLY_FLAG] and type(entry.file) == "string" then
                local hash = cloud_covers.hash_from_uri(entry.file)
                if hash and hash ~= "" then
                    set[hash] = true
                    cloud_only_count = cloud_only_count + 1
                end
            elseif entry._readest_group and store then
                local group = entry._readest_group
                local group_by = group._group_by
                if group_by then
                    local children = store:listBooksInGroup(
                        group_by, group.name, n_cells, sort_opts)
                    for _j, c in ipairs(children) do
                        if c.hash and c.hash ~= "" then
                            set[c.hash] = true
                            group_child_count = group_child_count + 1
                        end
                    end
                end
            end
        end
    end

    cloud_covers.set_visible_hashes(set)
    logger.info("ReadestLibrary set_visible_hashes: page=" .. page
        .. " range=" .. first .. ".." .. last
        .. " cloud_only=" .. cloud_only_count
        .. " group_children=" .. group_child_count
        .. " (item_table size=" .. #items .. ")")
end

-- ---------------------------------------------------------------------------
-- Entry constructors
-- ---------------------------------------------------------------------------

-- Group folder. Two render modes:
--   * opts.with_cover ~= false → entry.file = readest-group:// URI so
--     MosaicMenuItem treats it as a file and routes the paint through
--     the patched BIM, which serves a 2x2 cover mosaic.
--   * with_cover = false → entry has no `file` field, so the menu
--     widget renders the default folder treatment (rounded frame +
--     count badge).
function M.entry_from_group(group, opts)
    opts = opts or {}
    local entry = {
        text           = group.display_name or group.name,
        mandatory      = tostring(group.count or 0),
        _readest_group = group,
    }
    -- Stash group_by on the descriptor so list_strip can resolve
    -- children without re-parsing the URI.
    if opts.group_by then group._group_by = opts.group_by end
    if opts.group_by and opts.with_cover ~= false then
        local shape = opts.shape or "grid"
        local uri = group_covers.build_uri(opts.group_by, group.name, shape)
        entry.file = uri
        entry.is_file = true
        -- Stash by URI so the BIM patch can return a proper title for
        -- FakeCover when the composite isn't cached yet on first paint.
        cloud_covers.set_meta(uri, {
            title = group.display_name or group.name,
        })
    end
    return entry
end

-- "Up one level" entry. _readest_back_to is the parent path to
-- navigate to (nil = back to root); the boolean flag distinguishes a
-- root-back entry from a regular row that just happens to lack a
-- back path.
function M.entry_back(parent_path, label)
    return {
        text             = label,
        mandatory        = "",
        _readest_is_back = true,
        _readest_back_to = parent_path,
    }
end

-- Convert a LibraryStore row into a Menu item_table entry. The Menu
-- item layer expects entry.file, entry.text, entry.is_file etc.
-- _readest_row is preserved so the tap handler in librarywidget can
-- dispatch on cloud_present / local_present without re-querying.
function M.entry_from_row(row, _opts)
    if not row then return nil end
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
        -- BIM patch tags this path with _no_provider so ListMenuItem
        -- renders mandatory verbatim (= the format) without the
        -- trailing "<filetype>  " padding the standard format-string
        -- adds when mandatory is short. Keeps right-side text
        -- right-aligned with cloud rows that already use _no_provider.
        entry.mandatory = ext
        bim_patch.register_local_path(row.file_path)
        -- Mark "local but not in cloud" so the paintTo overlay paints
        -- the cloud-upload icon (mirroring Readest's BookItem rule:
        -- !uploadedAt → cloud-up).
        if (row.cloud_present or 0) == 0 then
            entry[M.LOCAL_ONLY_FLAG] = true
        end
    else
        -- Encode the real extension into the URI so listmenu's
        -- splitFileNameType returns a non-nil filetype for the right
        -- column. The patched BIM strips it back off.
        entry.file = cloud_covers.URI_PREFIX .. row.hash .. "." .. ext
        entry[M.CLOUD_ONLY_FLAG] = true
        -- Same _no_provider treatment as the local branch.
        entry.mandatory = ext
        -- Stash title/author by hash so the patched BIM (keyed by URI
        -- /path, not by row) can return them for FakeCover.
        cloud_covers.set_meta(row.hash, {
            title  = row.title,
            author = row.author,
        })
    end
    entry._readest_row = row
    return entry
end

return M
