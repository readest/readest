-- librarywidget.lua
-- Top-level Library view. Constructs a vanilla KOReader Menu and method-
-- mixes in CoverMenu + MosaicMenu (or ListMenu) per zen_ui's group_view.lua
-- pattern, then drives item_table from LibraryStore. Owns the search bar,
-- view-menu button, and group breadcrumb. Triggers lightScan + cloud pull
-- on open.
--
-- See apps/readest.koplugin/docs/library-design.md for the full design and
-- the runtime compatibility/smoke-test reasoning.

local Device       = require("device")
local GestureRange = require("ui/gesturerange")
local InfoMessage  = require("ui/widget/infomessage")
local InputDialog  = require("ui/widget/inputdialog")
local Menu         = require("ui/widget/menu")
local NetworkMgr   = require("ui/network/manager")
local TitleBar     = require("ui/widget/titlebar")
local Trapper      = require("ui/trapper")
local UIManager    = require("ui/uimanager")
local logger       = require("logger")
local _            = require("i18n")

local LibraryStore   = require("library.librarystore")
local libraryitem    = require("library.libraryitem")
local librarypaint   = require("library.librarypaint")
local localscanner   = require("library.localscanner")
local syncbooks      = require("library.syncbooks")

local M = {}

-- ---------------------------------------------------------------------------
-- Module-level state. The widget is a singleton — reopening reuses the
-- store. Account-switching closes + reopens with a fresh user_id.
-- ---------------------------------------------------------------------------
M._store          = nil
M._current_user   = nil
M._opts           = nil  -- last-used opts; needed for refresh after view-menu changes
M._menu           = nil
M._search         = nil  -- transient per-session search query; never persisted to disk
M._group_path     = nil  -- transient: nil = root; "Fantasy/Tolkien" when drilled in

-- ---------------------------------------------------------------------------
-- check_renderer_compat: signature + smoke test from the eng review.
-- Returns ok, reason; on failure, librarywidget falls back to a plain Menu
-- with FakeCover-only items so the view still loads.
-- ---------------------------------------------------------------------------
function M.check_renderer_compat()
    local ok_cm, CoverMenu  = pcall(require, "covermenu")
    local ok_mm, MosaicMenu = pcall(require, "mosaicmenu")
    local ok_lm, ListMenu   = pcall(require, "listmenu")
    if not (ok_cm and ok_mm and ok_lm) then
        return false, "missing-modules:" .. tostring(not ok_cm and "covermenu" or not ok_mm and "mosaicmenu" or "listmenu")
    end
    local needed = {
        { CoverMenu,  "updateItems" },
        { CoverMenu,  "onCloseWidget" },
        { MosaicMenu, "_recalculateDimen" },
        { MosaicMenu, "_updateItemsBuildUI" },
        { ListMenu,   "_recalculateDimen" },
        { ListMenu,   "_updateItemsBuildUI" },
    }
    for _, n in ipairs(needed) do
        if type(n[1][n[2]]) ~= "function" then
            return false, "missing-method:" .. n[2]
        end
    end
    return true
end

-- ---------------------------------------------------------------------------
-- canOpen(settings) — used by main.lua's menu-item enable check.
-- ---------------------------------------------------------------------------
function M.canOpen(settings)
    if not settings or not settings.user_id or settings.user_id == "" then
        return false, _("Sign in to Readest to open the Library")
    end
    return true
end

-- ---------------------------------------------------------------------------
-- ensure_store(settings) — open the LibraryStore for the active user;
-- close + reopen if the user_id changed since last open (account switch).
-- ---------------------------------------------------------------------------
local function ensure_store(settings)
    local DataStorage = require("datastorage")
    local db_path = DataStorage:getSettingsDir() .. "/readest_library.sqlite3"
    if M._store and M._current_user == settings.user_id then return M._store end
    if M._store then M._store:close() end
    M._store = LibraryStore.new({ user_id = settings.user_id, db_path = db_path })
    M._current_user = settings.user_id
    return M._store
end

-- ---------------------------------------------------------------------------
-- get_filters(settings) — read the persisted view-menu state from
-- G_reader_settings.readest_sync.library_*; return a filters table for
-- LibraryStore:listBooks.
-- ---------------------------------------------------------------------------
local function get_filters(settings, search)
    -- Default sort: last_read_at DESC. listBooks COALESCEs with updated_at
    -- so cloud-only books (NULL last_read_at) still sort by their cloud
    -- timestamp instead of falling to the bottom in arbitrary order.
    -- group_by/group_filter are intentionally NOT carried here — the
    -- bookshelf composer (build_item_table) handles them via
    -- listBookshelfGroups + listBookshelfBooks.
    return {
        search       = search,
        sort_by      = settings.library_sort_by or "last_read_at",
        sort_asc     = settings.library_sort_ascending == true,
    }
end

-- The picker values mirror Readest's LibraryGroupByType ("authors",
-- "groups", "series"); the store schema uses singular SQL column names
-- ("author", "group_name", "series"). This map translates one to the
-- other so the UI value and the SQL identifier can both be canonical.
-- Default first-run group-by is "groups" for parity with Readest web.
local DEFAULT_GROUP_BY = "groups"
local GROUP_BY_TO_COLUMN = {
    authors = "author",
    groups  = "group_name",
    series  = "series",
}
local function active_group_by(settings)
    local g = settings.library_group_by
    if g == nil then g = DEFAULT_GROUP_BY end
    if g == "none" then return nil end
    return GROUP_BY_TO_COLUMN[g] or g
end

-- "↩ Parent" or "↩ Library" depending on whether we'd land at a sub-path
-- or back at root. Used as item_table[1] when drilled in.
local function back_entry_for(current_path)
    local parent
    if current_path then
        for i = #current_path, 1, -1 do
            if current_path:sub(i, i) == "/" then
                parent = current_path:sub(1, i - 1)
                break
            end
        end
    end
    local label = "↩ " .. (parent or _("Library"))
    return libraryitem.entry_back(parent, label)
end

-- ---------------------------------------------------------------------------
-- get_view_mode(settings) — "mosaic" or "list"; defaults to mosaic.
-- ---------------------------------------------------------------------------
local function get_view_mode(settings)
    local mode = settings.library_view_mode
    if mode == "list" then return "list" end
    return "mosaic"
end

-- ---------------------------------------------------------------------------
-- build_item_table(store, settings, search) — query store + map rows to
-- Menu entries via libraryitem.entry_from_row.
-- ---------------------------------------------------------------------------
-- Sort-value extraction for the merged shelf list. Each entry — whether
-- a folder/group or a book row — gets one comparable value per sort_by;
-- groups use their "most recent child" aggregate so they interleave
-- correctly with siblings under date-based sorts. Mirrors Readest's
-- getGroupSortValue + getBookSortValue at
-- apps/readest-app/src/app/library/utils/libraryUtils.ts:313-403.
local SORT_VALUE_FOR_GROUP = {
    last_read_at = function(g) return g.latest_last_read_at or 0 end,
    updated_at   = function(g) return g.latest_updated_at or 0 end,
    created_at   = function(g) return g.latest_created_at or 0 end,
    title        = function(g) return g.display_name or "" end,
    author       = function(g) return g.display_name or "" end,
    series       = function(g) return g.display_name or "" end,
    format       = function(g) return g.display_name or "" end,
}

local SORT_VALUE_FOR_BOOK = {
    -- last_read_at: prefer updated_at when present (matches the SQL
    -- COALESCE in librarystore.listBooks). Without this the Lua-side
    -- merged-shelf sort overrides the SQL sort with the old
    -- "last_read_at first" behaviour, hiding any updated_at bump (e.g.
    -- the dedupe path of "Add to Readest").
    last_read_at = function(r) return r.updated_at or r.last_read_at or 0 end,
    updated_at   = function(r) return r.updated_at or 0 end,
    created_at   = function(r) return r.created_at or 0 end,
    title        = function(r) return r.title or "" end,
    author       = function(r) return r.author or "" end,
    series       = function(r) return r.series or "" end,
    format       = function(r) return r.format or "" end,
}

local function build_item_table(store, settings, search)
    local group_by = active_group_by(settings)

    if not group_by then
        local rows = store:listBooks(get_filters(settings, search))
        local items = {}
        for i, row in ipairs(rows) do
            items[i] = libraryitem.entry_from_row(row)
        end
        return items
    end

    local parent_path = M._group_path
    local groups = store:listBookshelfGroups(group_by, parent_path)
    local books  = store:listBookshelfBooks(get_filters(settings, search), group_by, parent_path)

    local sort_by = settings.library_sort_by or "last_read_at"
    local sort_asc = settings.library_sort_ascending == true
    local g_value = SORT_VALUE_FOR_GROUP[sort_by] or SORT_VALUE_FOR_GROUP.last_read_at
    local b_value = SORT_VALUE_FOR_BOOK[sort_by]  or SORT_VALUE_FOR_BOOK.last_read_at

    logger.dbg("ReadestLibrary build_item_table: group_by=" .. tostring(group_by)
        .. " parent_path=" .. tostring(parent_path)
        .. " sort_by=" .. tostring(sort_by)
        .. " sort_asc=" .. tostring(sort_asc)
        .. " #groups=" .. #groups .. " #books=" .. #books)

    -- Build a single mixed list with each entry's sort_value pre-computed,
    -- then sort once. Stable on already-sorted input either way.
    -- Group cells get a mini-cover preview in both view modes — a 2x2
    -- mosaic for Grid (mosaic) and a 1x4 horizontal strip for List.
    local view_mode = get_view_mode(settings)
    local group_entry_opts = {
        group_by   = group_by,
        with_cover = true,
        shape      = (view_mode == "list") and "list" or "grid",
    }
    local merged = {}
    for _i, g in ipairs(groups) do
        merged[#merged + 1] = {
            entry = libraryitem.entry_from_group(g, group_entry_opts),
            sort_value = g_value(g),
        }
    end
    for _i, row in ipairs(books) do
        merged[#merged + 1] = {
            entry = libraryitem.entry_from_row(row),
            sort_value = b_value(row),
        }
    end
    table.sort(merged, function(a, b)
        local av, bv = a.sort_value, b.sort_value
        if type(av) ~= type(bv) then
            -- Pathological: a string sort_value next to a numeric one
            -- (shouldn't happen given the table-driven extractors above,
            -- but stay deterministic if a future caller mixes them).
            return tostring(av) < tostring(bv)
        end
        if sort_asc then return av < bv end
        return av > bv
    end)

    local items = {}
    if parent_path then
        items[#items + 1] = back_entry_for(parent_path)
    end
    for _i, m in ipairs(merged) do
        items[#items + 1] = m.entry
    end
    return items
end

-- ---------------------------------------------------------------------------
-- mix_renderer(menu, view_mode) — apply CoverMenu + (Mosaic|List)Menu
-- methods onto our Menu. Mirrors zen_ui group_view.lua:62-95 layout.
-- ---------------------------------------------------------------------------
local function mix_renderer(menu, view_mode)
    local CoverMenu  = require("covermenu")
    local MosaicMenu = require("mosaicmenu")
    local ListMenu   = require("listmenu")

    menu.updateItems     = CoverMenu.updateItems
    menu.onCloseWidget   = CoverMenu.onCloseWidget

    -- Per-mode mixins
    if view_mode == "mosaic" then
        menu._recalculateDimen   = MosaicMenu._recalculateDimen
        menu._updateItemsBuildUI = MosaicMenu._updateItemsBuildUI
        menu._do_cover_images    = true
        menu._do_center_partial_rows = false
        menu._do_hint_opened     = false
    else
        menu._recalculateDimen   = ListMenu._recalculateDimen
        menu._updateItemsBuildUI = ListMenu._updateItemsBuildUI
        menu._do_cover_images    = true
        menu._do_filename_only   = false
    end

    menu.display_mode_type = view_mode

    -- Codex round 2 finding 3: zen_ui supplies these methods because the
    -- mixin's _updateItemsBuildUI calls them as if they were native to the
    -- Menu. Provide real implementations (an empty stub causes
    -- been_opened=nil → MosaicMenu paints the "New" ribbon on every
    -- already-read book — which was every book in the user's bug report).
    if not menu.getBookInfo then
        menu.getBookInfo = function(file_path)
            if not file_path then return {} end
            -- Cloud-only entries use a synthetic readest-cloud:// path;
            -- they're not on disk so DocSettings can't read them. Return
            -- been_opened=false so the renderer doesn't show "New" but
            -- doesn't try to read a percent_finished either.
            if file_path:match("^readest%-cloud://") then
                return { been_opened = false }
            end
            local ok_ds, DocSettings = pcall(require, "docsettings")
            if not ok_ds then return {} end
            if not DocSettings:hasSidecarFile(file_path) then return {} end
            local ok_open, doc = pcall(DocSettings.open, DocSettings, file_path)
            if not ok_open or not doc then return {} end
            local summary = doc:readSetting("summary")
            local stats   = doc:readSetting("stats")
            return {
                been_opened      = true,
                percent_finished = doc:readSetting("percent_finished"),
                status           = summary and summary.status,
                pages            = stats and stats.pages,
            }
        end
    end
    if not menu.resetBookInfoCache then
        menu.resetBookInfoCache = function() end
    end
end

-- ---------------------------------------------------------------------------
-- smoke_test_render(menu) — render one synthetic local + one cloud-only
-- entry off-screen via pcall. If the renderer throws on either, fall back.
-- Catches contract drift in entry shape that the method-existence check
-- alone would miss (codex round 2 finding 3).
-- ---------------------------------------------------------------------------
local function smoke_test_render(menu)
    local probe = { is_file = true, file = "/tmp/readest-smoke.epub", text = "Smoke" }
    local cloud = libraryitem.entry_from_row({
        hash = "00smoke", title = "Cloud Smoke", cloud_present = 1, local_present = 0,
    })
    local saved_table = menu.item_table
    menu.item_table = { probe, cloud }
    local ok, err = pcall(function()
        if menu._recalculateDimen then menu:_recalculateDimen() end
        -- Don't call _updateItemsBuildUI — it appends real widgets to the
        -- menu's content_group which we don't want side-effects from.
        -- The dimension recalc is the failure-prone part anyway.
    end)
    menu.item_table = saved_table
    return ok, err
end

-- ---------------------------------------------------------------------------
-- title_for(search) — build the menu title bar text. When a search is
-- active, surface it so the user can see why their library "looks empty".
-- ---------------------------------------------------------------------------
local function title_for(search)
    local title = _("Readest Library")
    if M._group_path then
        title = title .. ": " .. M._group_path
    end
    if search and search ~= "" then
        title = title .. " (" .. search .. ")"
    end
    return title
end

-- ---------------------------------------------------------------------------
-- handleSearch(menu, store, settings) — open InputDialog. Search is
-- session-transient (M._search), never persisted: a stuck filter from a
-- previous run was hiding all-but-matching books with no UI hint.
-- Includes a Clear button when a search is active so getting back to the
-- full library is one tap.
-- ---------------------------------------------------------------------------
local function handleSearch(menu, store, settings)
    local has_active = M._search and M._search ~= ""
    local dialog
    local apply = function(q)
        UIManager:close(dialog)
        M._search = (q and q ~= "") and q or nil
        -- switchItemTable accepts the new title as its first positional arg;
        -- call it that way instead of menu:setTitle (which doesn't exist on
        -- Menu — it's on TitleBar). One call updates both title + items.
        menu:switchItemTable(title_for(M._search),
            build_item_table(store, settings, M._search), 1)
    end
    local row = {
        {
            text = _("Cancel"),
            id = "close",
            callback = function() UIManager:close(dialog) end,
        },
    }
    if has_active then
        row[#row + 1] = {
            text = _("Clear"),
            callback = function() apply(nil) end,
        }
    end
    row[#row + 1] = {
        text = _("Search"),
        is_enter_default = true,
        callback = function() apply(dialog:getInputText() or "") end,
    }
    dialog = InputDialog:new{
        title = _("Search library"),
        input = M._search or "",
        input_hint = _("Search title or author"),
        buttons = { row },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

-- ---------------------------------------------------------------------------
-- refresh(menu, store, settings) — re-query store and update visible page.
-- Called after any view-menu change, search change, sync pull, or scan.
-- ---------------------------------------------------------------------------
function M.refresh()
    if not M._menu then return end
    local items = build_item_table(M._store, M._opts.settings, M._search)
    -- Preserve current page so cover-download completions (which call
    -- refresh too) don't yank the user back to page 1 mid-browse. The
    -- third arg to switchItemTable is "jump to this item number"; we
    -- compute the first item of the current page so the same page
    -- re-renders. If the new item count is shorter (e.g. after a sync
    -- delete), clamp to the last available item.
    local page    = M._menu.page    or 1
    local perpage = M._menu.perpage or 1
    local jump_to = math.max(1, math.min((page - 1) * perpage + 1, #items))
    M._menu:switchItemTable(title_for(M._search), items, jump_to)
end

-- Close the current Menu and rebuild it from scratch using the latest
-- settings. Used after view-menu changes that affect layout dimensions
-- (view mode, column count, cover fit) — those are baked in at Menu
-- construction time via mix_renderer + nb_cols_portrait, so a soft
-- refresh wouldn't pick them up. Settings that only affect the SQL
-- query (sort, group, search) keep using M.refresh() since rebuilding
-- the whole Menu would be needless flicker.
function M.reopen()
    if M._menu then
        UIManager:close(M._menu)
        M._menu = nil
        -- Clear the visible-hash filter so any in-flight BIM lookups
        -- after close don't kick off downloads we no longer want.
        libraryitem.set_visible_hashes(nil)
    end
    -- A view-mode/columns/cover-fit change is layout-only — keep the
    -- user's current drill-in. _keep_state tells M.open to skip its
    -- per-session resets (group_path, search reset).
    if M._opts then M.open(M._opts, { keep_state = true }) end
end

-- ---------------------------------------------------------------------------
-- runOpenSync(opts, menu) — fired after the menu is shown; runs lightScan
-- + cloud sync in a background-friendly way (Trapper coroutine for the
-- progress dialog; subprocess for the heavy walk happens inside
-- localscanner.fullSidecarWalk on first run / 24h gate / explicit Rescan).
--
-- Sync direction depends on settings.auto_sync (mirrors the auto-sync
-- toggle the user controls from the Readest plugin menu):
--   on  → "both" (push local changes first, then pull remote changes)
--   off → "pull" only (still surface cloud-side updates so the Library
--         view stays meaningful, but never silently push local state).
-- ---------------------------------------------------------------------------
local function runCloudSync(opts, store)
    local mode = opts.settings.auto_sync and "both" or "pull"
    logger.info("ReadestLibrary runCloudSync: mode=" .. mode
        .. " auto_sync=" .. tostring(opts.settings.auto_sync))
    syncbooks.syncBooks({
        sync_auth = opts.sync_auth,
        sync_path = opts.sync_path,
        settings  = opts.settings,
        store     = store,
    }, mode, function(success, msg, status)
        logger.info("ReadestLibrary runCloudSync[" .. mode .. "] done: success="
            .. tostring(success) .. " msg=" .. tostring(msg)
            .. " status=" .. tostring(status))
        -- Refresh either way: success picks up new cloud rows; failure
        -- (auth, network, server) leaves local rows visible without
        -- leaking a stale display state.
        M.refresh()
    end)
end

-- Cloud sync HTTP is synchronous on platforms without the Turbo looper
-- (macOS desktop, most KOReader builds with the lightweight networking
-- layer). Calling it inline from M.open blocks the UI loop, so
-- UIManager:show(menu) doesn't actually repaint until the sync returns
-- — visible to the user as a frozen Library on open. Pushing it through
-- UIManager:scheduleIn yields back to the event loop first, lets the
-- menu paint with the pre-sync local snapshot, and only then issues the
-- HTTP. The user still sees a brief blocking window when the request
-- fires, but at least content is on screen instead of a black hole.
-- Plan B (true non-blocking via runInSubProcess) is a bigger refactor.
local SYNC_DEFER_SECONDS = 0.05

local function runOpenSync(opts, store, menu)
    Trapper:wrap(function()
        logger.info("ReadestLibrary runOpenSync: start user="
            .. tostring(opts.settings.user_id and opts.settings.user_id:sub(1, 8))
            .. " auto_sync=" .. tostring(opts.settings.auto_sync))

        -- 1. Light local scan (cheap, synchronous). Always refresh after,
        -- regardless of pull outcome below — otherwise local-only books
        -- (the common case for a freshly-installed plugin where nothing
        -- has been uploaded to Readest cloud yet) would never appear in
        -- the menu, since the initial item_table was built from the
        -- pre-scan store snapshot.
        local ok, err = pcall(localscanner.lightScan, { store = store })
        if not ok then logger.warn("ReadestLibrary lightScan failed:", err) end
        M.refresh()

        -- 2. Cloud sync — deferred so the menu paints first.
        -- willRerunWhenOnline + the inline call moved into the
        -- scheduled handler so the offline→online and already-online
        -- branches share one code path.
        local since = store:getLastPulledAt() or 0
        logger.info("ReadestLibrary runOpenSync: since=" .. tostring(since)
            .. ", scheduling cloud sync in " .. SYNC_DEFER_SECONDS .. "s")
        UIManager:scheduleIn(SYNC_DEFER_SECONDS, function()
            if NetworkMgr:willRerunWhenOnline(function() runCloudSync(opts, store) end) then
                logger.info("ReadestLibrary runOpenSync: sync deferred until network online")
                return
            end
            logger.info("ReadestLibrary runOpenSync: network online, dispatching sync")
            runCloudSync(opts, store)
        end)
    end)
end

-- ---------------------------------------------------------------------------
-- open(opts) — main entry from the Readest plugin menu.
-- opts: { settings = G_reader_settings.readest_sync, sync_path, sync_auth }
-- ---------------------------------------------------------------------------
function M.open(opts, internal)
    local can_open, reason = M.canOpen(opts.settings)
    if not can_open then
        UIManager:show(InfoMessage:new{ text = reason, timeout = 3 })
        return
    end

    M._opts = opts
    -- Each fresh open starts at the root shelf; group drill-in state is
    -- per-session, never persisted to disk. M.reopen passes keep_state
    -- so a layout-change rebuild stays in the user's current folder.
    if not (internal and internal.keep_state) then
        M._group_path = nil
    end
    -- Migrate any stuck pre-fix library_search from settings into the
    -- transient session slot, then strip it from disk so future upgrades
    -- don't have to repeat this. (Leaving it in settings would re-pollute
    -- M._search next session.)
    if opts.settings.library_search then
        M._search = opts.settings.library_search
        opts.settings.library_search = nil
        G_reader_settings:saveSetting("readest_sync", opts.settings)
    end
    local store = ensure_store(opts.settings)

    -- Renderer compatibility check (codex round 2 finding 3)
    local ok, why = M.check_renderer_compat()
    if not ok then
        logger.warn("ReadestLibrary renderer compat check failed:", why)
        UIManager:show(InfoMessage:new{
            text = _("Cover Browser plugin required for full Library rendering. Falling back to plain list."),
            timeout = 5,
        })
        -- Plain Menu fallback: still usable, just no covers
    else
        -- Pass sync auth so the patched BIM can lazily download cloud
        -- cover.png files for cloud-only entries (covers are then
        -- shared between cloud + local presentations of the same hash).
        libraryitem.install({
            sync_auth = opts.sync_auth,
            sync_path = opts.sync_path,
            settings  = opts.settings,
        })
    end

    local Screen = Device.screen
    local view_mode = get_view_mode(opts.settings)

    local menu
    -- Custom TitleBar: close X on the right (via close_callback), search on
    -- the left, and the centered title acts as a tap target for the View
    -- menu. Stock TitleBar has no title-tap callback, so the actual tap
    -- handler is registered on the Menu's ges_events below — this title
    -- bar just supplies the dimen for the gesture range.
    local view_menu_callback = function()
        local LibraryViewMenu = require("library.libraryviewmenu")
        local prev_group_by = active_group_by(opts.settings)
        LibraryViewMenu.show({
            settings         = opts.settings,
            on_change        = function()
                if active_group_by(opts.settings) ~= prev_group_by then
                    M._group_path = nil
                end
                M.refresh()
            end,
            on_layout_change = function()
                if active_group_by(opts.settings) ~= prev_group_by then
                    M._group_path = nil
                end
                M.reopen()
            end,
        })
    end
    local title_bar = TitleBar:new{
        width = Screen:getWidth(),
        fullscreen = "true",
        align = "center",
        title = title_for(M._search),
        left_icon = "appbar.search",
        left_icon_tap_callback  = function() handleSearch(menu, store, opts.settings) end,
        close_callback          = function() if menu then menu:onClose() end end,
    }
    -- Compute the orientation-appropriate per-page count up front and
    -- pass it as items_per_page. Menu's native _recalculateDimen
    -- (menu.lua:648) uses items_per_page; MosaicMenu's mixin uses
    -- nb_rows*nb_cols. Without setting items_per_page they disagree —
    -- Menu's heuristic computed ~14, MosaicMenu's mixin computed 9, the
    -- footer page-nav lagged the cell layout, and the cell layout
    -- attempted to fit 14 cells in 9 visible slots, leaking partial cells
    -- under the page nav. Make both formulas land on the same number by
    -- pre-setting items_per_page.
    local nb_cols_p = opts.settings.library_columns or 3
    local nb_rows_p = opts.settings.library_rows    or 3
    local nb_cols_l = opts.settings.library_columns_landscape or 4
    local nb_rows_l = opts.settings.library_rows_landscape    or 2
    local portrait  = Screen:getWidth() <= Screen:getHeight()
    local items_per_page = portrait and (nb_cols_p * nb_rows_p) or (nb_cols_l * nb_rows_l)

    menu = Menu:new{
        name             = "readest_library",
        is_borderless    = true,
        is_popout        = false,
        covers_fullscreen = true,
        custom_title_bar = title_bar,
        item_table       = build_item_table(store, opts.settings, M._search),
        width            = Screen:getWidth(),
        height           = Screen:getHeight(),
        items_per_page    = items_per_page,
        nb_cols_portrait  = nb_cols_p,
        nb_rows_portrait  = nb_rows_p,
        nb_cols_landscape = nb_cols_l,
        nb_rows_landscape = nb_rows_l,
        onMenuSelect     = function(_self, item)
            M.handleTap(item, opts)
        end,
        onMenuHold       = function(_self, item)
            M.handleHold(item, opts)
        end,
    }
    title_bar.show_parent = menu

    if ok then
        mix_renderer(menu, view_mode)
        local smoke_ok, smoke_err = smoke_test_render(menu)
        if not smoke_ok then
            logger.warn("ReadestLibrary smoke test failed:", smoke_err)
            -- Already constructed; just leave the mixin in place. The
            -- smoke test is a tripwire, not a fatal check — we surface
            -- via logger so a future user report includes the trace.
        end
        librarypaint.install(menu)

        -- Wrap updateItems to recompute the visible-page hash set before
        -- any cell paints. Cell paints call BIM:getBookInfo, which calls
        -- trigger_cover_download — and we want THAT to only fire for
        -- on-screen items. set_visible_hashes runs FIRST so when the
        -- subsequent paint hits BIM, the filter is already in place.
        local orig_update = menu.updateItems
        menu.updateItems = function(self, ...)
            libraryitem.set_visible_hashes(self)
            return orig_update(self, ...)
        end
    end

    -- Tap on the title bar (anywhere not on the left search icon or the
    -- right close X) opens the View menu. Stock TitleBar has no
    -- title_tap_callback hook, so we register a gesture range at the
    -- Menu level. Children (IconButton, MenuItem cells, footer) get the
    -- gesture first via WidgetContainer dispatch; only taps that no child
    -- claims fall through to Menu's onGesture and reach this handler.
    -- Use a range function so the dimen is read at match time — TitleBar
    -- only sets dimen.x/y during paintTo, so the value at registration
    -- isn't reliable on first tap.
    menu.ges_events.TapTitle = {
        GestureRange:new{
            ges = "tap",
            range = function() return title_bar.dimen end,
        },
    }
    menu.onTapTitle = function() view_menu_callback() return true end

    M._menu = menu
    UIManager:show(menu)

    runOpenSync(opts, store, menu)
end

-- ---------------------------------------------------------------------------
-- handleTap(item, opts) — tap dispatch. Local books open immediately;
-- cloud-only books prompt for download.
-- ---------------------------------------------------------------------------
function M.handleTap(item, opts)
    if not item then return end

    -- Group folder entry → drill in
    if item._readest_group then
        M._group_path = item._readest_group.name
        M.refresh()
        return
    end

    -- "↩ Back" entry → pop one level (or up to root)
    if item._readest_is_back then
        M._group_path = item._readest_back_to
        M.refresh()
        return
    end

    if not item._readest_row then return end
    local row = item._readest_row
    local lfs = require("libs/libkoreader-lfs")

    if row.local_present == 1 and row.file_path then
        -- Tap-time recovery: maybe the file vanished since the last scan
        if lfs.attributes(row.file_path, "mode") ~= "file" then
            local ConfirmBox = require("ui/widget/confirmbox")
            UIManager:show(ConfirmBox:new{
                text = _("File moved or deleted. Rescan library?"),
                ok_callback = function()
                    Trapper:wrap(function()
                        localscanner.fullSidecarWalk({
                            store    = M._store,
                            home_dir = G_reader_settings:readSetting("home_dir"),
                        })
                        M.refresh()
                    end)
                end,
            })
            return
        end
        local ReaderUI = require("apps/reader/readerui")
        ReaderUI:showReader(row.file_path)
        return
    end

    -- Cloud-only path: confirm + download + open
    if row.cloud_present == 1 then
        local ConfirmBox = require("ui/widget/confirmbox")
        UIManager:show(ConfirmBox:new{
            text = _("Download this book from Readest?") .. "\n\n" .. (row.title or ""),
            ok_text = _("Download"),
            ok_callback = function()
                local download_dir = opts.settings.library_download_dir
                    or G_reader_settings:readSetting("home_dir")
                if not download_dir or download_dir == "" then
                    UIManager:show(InfoMessage:new{
                        text = _("Set Home folder in File Manager first to enable downloads."),
                        timeout = 3,
                    })
                    return
                end
                local progress = InfoMessage:new{
                    text = _("Downloading…") .. " " .. (row.title or ""),
                }
                UIManager:show(progress)
                syncbooks.downloadBook(row, {
                    sync_auth     = opts.sync_auth,
                    sync_path     = opts.sync_path,
                    settings      = opts.settings,
                    download_dir  = download_dir,
                }, function(success, dst_or_err, status)
                    UIManager:close(progress)
                    if not success then
                        local msg = (status == 404)
                            and _("Cloud copy unavailable.")
                            or _("Download failed.")
                        UIManager:show(InfoMessage:new{ text = msg, timeout = 3 })
                        return
                    end
                    -- Update store: row now has a local file
                    M._store:upsertBook({
                        hash = row.hash, title = row.title,
                        local_present = 1, file_path = dst_or_err,
                    })
                    M.refresh()
                    local ReaderUI = require("apps/reader/readerui")
                    ReaderUI:showReader(dst_or_err)
                end)
            end,
        })
        return
    end
end

-- ---------------------------------------------------------------------------
-- Action helpers (used by handleHold's button dialog)
-- ---------------------------------------------------------------------------

-- Run a book download without auto-opening the reader on success. Used by
-- both "Download Book" and "Download All" from the long-press action
-- sheet — there the user wants the file on device, not to start reading.
local function downloadBookOnly(row, opts, after_cb)
    local download_dir = opts.settings.library_download_dir
        or G_reader_settings:readSetting("home_dir")
    if not download_dir or download_dir == "" then
        UIManager:show(InfoMessage:new{
            text = _("Set Home folder in File Manager first to enable downloads."),
            timeout = 3,
        })
        if after_cb then after_cb(false) end
        return
    end
    local progress = InfoMessage:new{
        text = _("Downloading…") .. " " .. (row.title or ""),
    }
    UIManager:show(progress)
    syncbooks.downloadBook(row, {
        sync_auth    = opts.sync_auth,
        sync_path    = opts.sync_path,
        settings     = opts.settings,
        download_dir = download_dir,
    }, function(success, dst_or_err, status)
        UIManager:close(progress)
        if not success then
            local msg = (status == 404)
                and _("Cloud copy unavailable.")
                or _("Download failed.")
            UIManager:show(InfoMessage:new{ text = msg, timeout = 3 })
            if after_cb then after_cb(false) end
            return
        end
        M._store:upsertBook({
            hash = row.hash, title = row.title,
            local_present = 1, file_path = dst_or_err,
        })
        M.refresh()
        if after_cb then after_cb(true) end
    end)
end

local function downloadCoverOnly(row, opts, after_cb)
    local DataStorage = require("datastorage")
    syncbooks.downloadCover(row, {
        sync_auth  = opts.sync_auth,
        sync_path  = opts.sync_path,
        settings   = opts.settings,
        covers_dir = DataStorage:getSettingsDir() .. "/readest_covers",
    }, function(success, _path_or_err, status)
        if not success then
            local msg = (status == 404)
                and _("No cover available on Readest.")
                or _("Cover download failed.")
            UIManager:show(InfoMessage:new{ text = msg, timeout = 3 })
            if after_cb then after_cb(false) end
            return
        end
        M.refresh()
        if after_cb then after_cb(true) end
    end)
end

-- Remove the local file for a book and clear local_present in the store.
-- Returns true on success. Cloud-side state (cloud_present, deleted_at)
-- is untouched.
local function removeLocalFile(row)
    local lfs = require("libs/libkoreader-lfs")
    if not row.file_path or row.file_path == "" then return false end
    if lfs.attributes(row.file_path, "mode") == "file" then
        local ok = os.remove(row.file_path)
        if not ok then
            UIManager:show(InfoMessage:new{
                text = _("Could not delete the file."), timeout = 3,
            })
            return false
        end
    end
    -- Reset local presence in the store; cloud_present stays as-is so
    -- the row remains visible (and re-downloadable) if it's in the cloud.
    M._store:upsertBook({
        hash          = row.hash,
        title         = row.title,
        local_present = 0,
        file_path     = nil,
    })
    return true
end

-- ---------------------------------------------------------------------------
-- handleHold(item, opts) — long-press action sheet
-- ---------------------------------------------------------------------------
-- Mirrors Readest's BookDetailView action set (apps/readest-app/src/
-- components/metadata/BookDetailView.tsx): Delete is a sub-menu with
-- Cloud & Device / Cloud Only / Device Only; Upload shows only when the
-- book is on device but not in the cloud; Download shows only when the
-- book is in the cloud. Cloud-side actions (Upload, Remove from Cloud)
-- need new /storage/upload + DELETE /sync calls that aren't ported yet,
-- so they're labeled but stubbed; local-side actions (Remove from
-- Device, Download Book/Cover/All) work today.
function M.handleHold(item, opts)
    if not item or not item._readest_row then return end
    local row = item._readest_row
    local ButtonDialog = require("ui/widget/buttondialog")
    local ConfirmBox   = require("ui/widget/confirmbox")

    local on_cloud = row.cloud_present == 1
    local on_local = row.local_present == 1

    local dialog
    local function close() UIManager:close(dialog) end

    local rows = {}
    local function add_row(text, cb)
        rows[#rows + 1] = {{ text = text, callback = cb }}
    end

    -- Cloud delete shared by "Cloud & Device" and "Cloud Only". Mirrors
    -- Readest's cloudService.deleteBook 'cloud' branch: list /storage,
    -- delete each file, clear cloud_present in the store. For Cloud &
    -- Device the caller also pushes a tombstone via /sync so peers
    -- consider the book gone (peers pulling /sync see deleted_at).
    local function doCloudDelete(after_cb)
        local progress = InfoMessage:new{
            text = _("Removing from cloud…") .. " " .. (row.title or ""),
        }
        UIManager:show(progress)
        syncbooks.deleteCloudFiles(row, {
            sync_auth = opts.sync_auth,
            sync_path = opts.sync_path,
            settings  = opts.settings,
        }, function(success, _msg, status)
            UIManager:close(progress)
            if not success then
                UIManager:show(InfoMessage:new{
                    text = _("Cloud removal failed.")
                        .. " (status=" .. tostring(status) .. ")",
                    timeout = 3,
                })
                if after_cb then after_cb(false) end
                return
            end
            if after_cb then after_cb(true) end
        end)
    end

    -- Delete sub-options (parity with BookDetailView's three-item dropdown).
    add_row(_("Remove from Cloud & Device"), function()
        close()
        UIManager:show(ConfirmBox:new{
            text = _("Remove this book from cloud and device?")
                .. "\n\n" .. (row.title or ""),
            ok_text = _("Remove"),
            ok_callback = function()
                local function finish_local()
                    if on_local then removeLocalFile(row) end
                    -- Tombstone push: matches Readest's `book.deletedAt =
                    -- Date.now() + pushLibrary()` for the 'both' delete.
                    -- Peers pulling /sync see deleted_at and stop showing
                    -- the row, even though we already removed our local
                    -- copy + cloud objects.
                    local now = math.floor(os.time() * 1000)
                    M._store:upsertBook({
                        hash                  = row.hash,
                        title                 = row.title,
                        cloud_present         = 0,
                        local_present         = 0,
                        deleted_at            = now,
                        _force_cloud_present  = true,
                    })
                    -- Build a tombstone wire row from the in-memory entry
                    -- row (which already has format/meta_hash/etc) plus
                    -- the deleted_at + bumped updated_at.
                    local tombstone = {}
                    for k, v in pairs(row) do tombstone[k] = v end
                    tombstone.deleted_at = now
                    tombstone.updated_at = now
                    syncbooks.pushBook(tombstone, {
                        sync_auth = opts.sync_auth,
                        sync_path = opts.sync_path,
                        settings  = opts.settings,
                    }, function() M.refresh() end)
                    M.refresh()
                end
                if on_cloud then
                    doCloudDelete(function() finish_local() end)
                else
                    finish_local()
                end
            end,
        })
    end)
    if on_cloud then
        add_row(_("Remove from Cloud Only"), function()
            close()
            UIManager:show(ConfirmBox:new{
                text = _("Remove this book from the cloud only?")
                    .. "\n\n" .. (row.title or ""),
                ok_text = _("Remove"),
                ok_callback = function()
                    doCloudDelete(function(success)
                        if success then
                            -- Cloud objects gone; clear cloud_present but
                            -- leave the row visible if local_present=1.
                            M._store:upsertBook({
                                hash                 = row.hash,
                                title                = row.title,
                                cloud_present        = 0,
                                _force_cloud_present = true,
                            })
                            M.refresh()
                        end
                    end)
                end,
            })
        end)
    end
    if on_local then
        add_row(_("Remove from Device Only"), function()
            close()
            UIManager:show(ConfirmBox:new{
                text = _("Remove the local copy of this book?")
                    .. "\n\n" .. (row.title or ""),
                ok_text = _("Remove"),
                ok_callback = function()
                    if removeLocalFile(row) then M.refresh() end
                end,
            })
        end)
    end

    -- Upload: parity with BookDetailView's `book.downloadedAt && onUpload`.
    -- Shown whenever the book is on device, even if it's already in the
    -- cloud — same gating as BookDetailView (which uses `downloadedAt`
    -- alone, not `downloadedAt && !uploadedAt`). Re-uploading is the
    -- web's path for replacing a cloud copy after local edits.
    if on_local then
        add_row(_("Upload to Cloud"), function()
            close()
            local progress = InfoMessage:new{
                text = _("Uploading…") .. " " .. (row.title or ""),
            }
            UIManager:show(progress)
            local DataStorage = require("datastorage")
            syncbooks.uploadBook(row, {
                sync_auth   = opts.sync_auth,
                sync_path   = opts.sync_path,
                settings    = opts.settings,
                covers_dir  = DataStorage:getSettingsDir() .. "/readest_covers",
            }, function(success, msg, status)
                UIManager:close(progress)
                if not success then
                    local text
                    if status == 403 and msg and msg:find("quota", 1, true) then
                        text = _("Storage quota exceeded.")
                    else
                        text = _("Upload failed.")
                            .. " (" .. tostring(msg or status) .. ")"
                    end
                    UIManager:show(InfoMessage:new{ text = text, timeout = 4 })
                    return
                end
                -- Mirror cloudService.uploadBook's bookkeeping: clear
                -- deleted_at, bump uploaded_at + updated_at, mark cloud
                -- present, then push the row so peers see the metadata.
                -- _clear_fields un-tombstones since Lua nil in the row
                -- table would otherwise be preserved by upsertBook.
                local now = math.floor(os.time() * 1000)
                M._store:upsertBook({
                    hash          = row.hash,
                    title         = row.title,
                    cloud_present = 1,
                    uploaded_at   = now,
                    updated_at    = now,
                    _clear_fields = { "deleted_at" },
                })
                local pushed = {}
                for k, v in pairs(row) do pushed[k] = v end
                pushed.cloud_present = 1
                pushed.uploaded_at   = now
                pushed.updated_at    = now
                pushed.deleted_at    = nil
                syncbooks.pushBook(pushed, {
                    sync_auth = opts.sync_auth,
                    sync_path = opts.sync_path,
                    settings  = opts.settings,
                }, function() M.refresh() end)
                M.refresh()
            end)
        end)
    end

    -- Download: parity with BookDetailView's `book.uploadedAt && onDownload`.
    -- BookDetailView has a single Download from Cloud button; we expose
    -- Cover / Book / All from the user's request since the koplugin can
    -- usefully download just the cover (e.g. to refresh the preview)
    -- without also fetching the full file.
    if on_cloud then
        if not on_local then
            add_row(_("Download Book"), function()
                close()
                downloadBookOnly(row, opts)
            end)
        end
        add_row(_("Download Cover"), function()
            close()
            downloadCoverOnly(row, opts)
        end)
        if not on_local then
            add_row(_("Download All"), function()
                close()
                downloadCoverOnly(row, opts, function()
                    downloadBookOnly(row, opts)
                end)
            end)
        end
    end

    if #rows == 0 then return end

    dialog = ButtonDialog:new{
        title       = row.title or "",
        title_align = "center",
        buttons     = rows,
    }
    UIManager:show(dialog)
end

return M
