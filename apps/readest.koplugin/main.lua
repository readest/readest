local Dispatcher = require("dispatcher")
local InfoMessage = require("ui/widget/infomessage")
local KeyValuePage = require("ui/widget/keyvaluepage")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local sha2 = require("ffi/sha2")
local T = require("ffi/util").template
local _ = require("i18n")

local SyncAuth = require("syncauth")
local SyncConfig = require("syncconfig")
local SyncAnnotations = require("syncannotations")
local SelfUpdate = require("selfupdate")

local ReadestSync = WidgetContainer:new{
    name = "readest",
    title = _("Readest"),
    settings = nil,
}

local API_CALL_DEBOUNCE_DELAY = 30
local SUPABAE_ANON_KEY_BASE64 = "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5aaWMzbDRablZ6YW1weFpIaHJhbkZzZVhOaklpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTXpReE1qTTJOekVzSW1WNGNDSTZNakEwT1RZNU9UWTNNWDAuM1U1VXFhb3VfMVNnclZlMWVvOXJBcGMwdUtqcWhwUWRVWGh2d1VIbVVmZw=="

ReadestSync.default_settings = {
    supabase_url = "https://readest.supabase.co",
    supabase_anon_key = sha2.base64_to_bin(SUPABAE_ANON_KEY_BASE64),
    auto_sync = false,
    user_email = nil,
    user_name = nil,
    user_id = nil,
    access_token = nil,
    refresh_token = nil,
    expires_at = nil,
    expires_in = nil,
    last_sync_at = nil,
}

-- ── Lifecycle ──────────────────────────────────────────────────────

function ReadestSync:init()
    self.last_sync_timestamp = 0
    self.settings = G_reader_settings:readSetting("readest_sync", self.default_settings)

    local meta = dofile(self.path .. "/_meta.lua")
    self.installed_version = meta and meta.version and tostring(meta.version)

    self.ui.menu:registerToMainMenu(self)
    -- Dispatcher actions (gestures / quick menu entries). Registering
    -- here in init() rather than onReaderReady so the FileManager-only
    -- actions (Readest Library, Push books, Pull books — flagged with
    -- general=true) show up in FileManager → Settings → Taps and gestures
    -- when no document is open. Reader-only actions (auto sync etc.)
    -- still get registered on first plugin load too — they just don't
    -- fire until a document opens.
    self:onDispatcherRegisterActions()
    -- Long-press file menu in FileManager: add an "Add to Readest"
    -- entry that hashes the file, registers it in the LibraryStore, and
    -- uploads it to the user's Readest cloud. Skipped in reader context
    -- (FileManager.instance is nil there).
    self:registerFileDialogButton()
end

-- Register Library actions (Open / Push / Pull) — available in both
-- reader and FileManager via the `general=true` flag.
function ReadestSync:onDispatcherRegisterActions()
    Dispatcher:registerAction("readest_open_library", { category="none", event="ReadestOpenLibrary", title=_("Open Readest Library"), general=true,})
    Dispatcher:registerAction("readest_push_books", { category="none", event="ReadestPushBooks", title=_("Push Readest book library"), general=true,})
    Dispatcher:registerAction("readest_pull_books", { category="none", event="ReadestPullBooks", title=_("Pull Readest book library"), general=true,})
end

-- Reader-only actions (progress + annotations sync) — registered only
-- after a document opens, so they don't appear in the gesture picker
-- when FileManager is the foreground context. They'd never fire from
-- FileManager anyway (the handlers operate on the active ReaderUI), so
-- showing them there would just be noise.
function ReadestSync:onDispatcherRegisterReaderActions()
    Dispatcher:registerAction("readest_sync_set_autosync",
        { category="string", event="ReadestSyncToggleAutoSync", title=_("Set auto progress sync"), reader=true,
        args={true, false}, toggle={_("on"), _("off")},})
    Dispatcher:registerAction("readest_sync_toggle_autosync", { category="none", event="ReadestSyncToggleAutoSync", title=_("Toggle auto readest sync"), reader=true,})
    Dispatcher:registerAction("readest_sync_push_progress", { category="none", event="ReadestSyncPushProgress", title=_("Push readest progress from this device"), reader=true,})
    Dispatcher:registerAction("readest_sync_pull_progress", { category="none", event="ReadestSyncPullProgress", title=_("Pull readest progress from other devices"), reader=true, separator=true,})
    Dispatcher:registerAction("readest_sync_push_annotations", { category="none", event="ReadestSyncPushAnnotations", title=_("Push readest annotations from this device"), reader=true,})
    Dispatcher:registerAction("readest_sync_pull_annotations", { category="none", event="ReadestSyncPullAnnotations", title=_("Pull readest annotations from other devices"), reader=true, separator=true,})
end

function ReadestSync:onReaderReady()
    if self.settings.auto_sync and self.settings.access_token then
        UIManager:nextTick(function()
            self:pullBookConfig(false)
            self:pullBookNotes(false)
        end)
    end
    self:onDispatcherRegisterReaderActions()
end

-- Reverse-lookup table: file extension (lowercase) → Readest format
-- token (uppercase). Computed once at module load from EXTS so we don't
-- pay the iteration cost per long-press.
local _readest_format_for_ext = nil
local function readest_format_for_ext(ext)
    if not _readest_format_for_ext then
        _readest_format_for_ext = {}
        local EXTS = require("library.exts")
        for fmt, e in pairs(EXTS) do _readest_format_for_ext[e] = fmt end
    end
    return ext and _readest_format_for_ext[ext:lower()]
end

-- Register an "Add to Readest" button in FileManager's long-press file
-- dialog (the one with Paste / Cut / Delete / Copy / Reading / On hold
-- / etc.). The button only renders for supported book formats and
-- when the user is signed in to Readest.
--
-- Why scheduleIn(0): plugin init() runs while KOReader is still
-- constructing the FileManager — FileManager.instance is not yet
-- assigned. Deferring to the next event-loop tick (same trick simpleui
-- uses at plugins/simpleui.koplugin/main.lua:261) lets the FileManager
-- finish its own init first so .instance is populated when we look it
-- up. Safe in reader context too: .instance stays nil so we no-op.
function ReadestSync:registerFileDialogButton()
    local plugin = self
    UIManager:scheduleIn(0, function()
        local ok_FM, FileManager = pcall(require, "apps/filemanager/filemanager")
        if not ok_FM or not FileManager.instance then return end
        FileManager.instance:addFileDialogButtons("readest_add_to_library",
            function(file, is_file, _book_props)
                if not is_file then return nil end
                local ext = file:match("%.([^./\\]+)$")
                if not readest_format_for_ext(ext) then return nil end
                return {
                    {
                        text = _("Add to Readest"),
                        enabled = plugin.settings.access_token ~= nil,
                        callback = function()
                            local fc = FileManager.instance and FileManager.instance.file_chooser
                            local dlg = fc and fc.file_dialog
                            if dlg then UIManager:close(dlg) end
                            plugin:addToReadest(file)
                        end,
                    },
                }
            end)
    end)
end

-- Hash the file, upsert a Library row, then upload to cloud. Mirrors
-- the upload flow we already use in librarywidget's "Upload to Cloud"
-- action — the only new thing here is computing the partial_md5 from
-- the file directly, since long-pressing in FileManager doesn't go
-- through the Library row path.
function ReadestSync:addToReadest(file)
    local lfs    = require("libs/libkoreader-lfs")
    local util   = require("util")

    if not self.settings.access_token then
        UIManager:show(InfoMessage:new{
            text = _("Sign in to Readest first."), timeout = 3,
        })
        return
    end
    local attr = lfs.attributes(file)
    if not attr or attr.mode ~= "file" then
        UIManager:show(InfoMessage:new{
            text = _("File not found."), timeout = 3,
        })
        return
    end
    local ext = file:match("%.([^./\\]+)$")
    local format = readest_format_for_ext(ext)
    if not format then
        UIManager:show(InfoMessage:new{
            text = _("Unsupported book format."), timeout = 3,
        })
        return
    end

    -- Hash via util.partialMD5 — same algorithm Readest uses, fast
    -- (reads small chunks at fixed offsets, no full-file scan).
    local progress = InfoMessage:new{
        text = _("Hashing book…"),
    }
    UIManager:show(progress)
    UIManager:nextTick(function()
        local hash = util.partialMD5(file)
        UIManager:close(progress)
        if not hash then
            UIManager:show(InfoMessage:new{
                text = _("Could not read file."), timeout = 3,
            })
            return
        end
        self:_addLocalRow(file, hash, format, attr.size)
    end)
end

function ReadestSync:_addLocalRow(file, hash, format, _size)
    local store = self:getLibraryStore()
    if not store then
        UIManager:show(InfoMessage:new{
            text = _("Sign in to Readest first."), timeout = 3,
        })
        return
    end

    -- Title: filename minus extension. BIM might have richer metadata
    -- if the user has opened the book before, but a filename-derived
    -- title is good enough for the row to round-trip — the user can
    -- later trigger an Upload to Cloud which carries it to Readest.
    local basename = file:match("([^/]+)$") or file
    local title = basename:gsub("%.[^.]+$", "")
    local now = math.floor(os.time() * 1000)
    logger.info("ReadestSync addToReadest: hash=" .. hash:sub(1, 8)
        .. " title=" .. tostring(title)
        .. " format=" .. tostring(format)
        .. " path=" .. tostring(file)
        .. " now=" .. tostring(now))

    -- Dedupe by partial_md5: if a non-tombstoned row with this hash is
    -- already in the user's library, just bump its updated_at and skip.
    -- Tombstoned rows (deleted_at set) are treated as "not in library"
    -- — re-adding writes a fresh local-only row with cloud_present=0.
    local existing = store:_getRowRaw(hash)
    if existing then
        logger.info("ReadestSync addToReadest: existing row found"
            .. " cloud_present=" .. tostring(existing.cloud_present)
            .. " local_present=" .. tostring(existing.local_present)
            .. " deleted_at=" .. tostring(existing.deleted_at)
            .. " updated_at=" .. tostring(existing.updated_at))
    else
        logger.info("ReadestSync addToReadest: no existing row — inserting")
    end
    if existing and existing.deleted_at == nil then
        store:upsertBook({
            hash          = hash,
            title         = existing.title or title,
            file_path     = file,
            local_present = 1,
            updated_at    = now,
        })
        logger.info("ReadestSync addToReadest dedupe: bumped updated_at for "
            .. hash:sub(1, 8) .. " to " .. tostring(now))
        local LibraryWidget = require("library.librarywidget")
        if LibraryWidget._menu then LibraryWidget.refresh() end
        UIManager:show(InfoMessage:new{
            text = _("Already in your Readest library:") .. " "
                .. (existing.title or title),
            timeout = 2,
        })
        return
    end

    -- Add as a local-only row (cloud_present defaults to 0). Stamp
    -- created_at + updated_at explicitly so the row sorts under "Date
    -- Added" / "Last Updated" right away, and so the next pushChangedBooks
    -- pass picks it up (its query is `updated_at > since`).
    -- _clear_fields un-tombstones the row when re-adding a previously-
    -- deleted book — passing deleted_at = nil alone wouldn't clear it
    -- because Lua tables drop nil keys and upsertBook's preserve pass
    -- would copy the existing tombstone forward.
    store:upsertBook({
        hash          = hash,
        title         = title,
        format        = format,
        file_path     = file,
        local_present = 1,
        created_at    = now,
        updated_at    = now,
        _clear_fields = { "deleted_at" },
    })
    local row = store:_getRowRaw(hash)
    logger.info("ReadestSync addToReadest insert: stored row"
        .. " updated_at=" .. tostring(row and row.updated_at)
        .. " created_at=" .. tostring(row and row.created_at)
        .. " cloud_present=" .. tostring(row and row.cloud_present)
        .. " local_present=" .. tostring(row and row.local_present))
    local LibraryWidget = require("library.librarywidget")
    if LibraryWidget._menu then LibraryWidget.refresh() end
    UIManager:show(InfoMessage:new{
        text = _("Added to Readest:") .. " " .. title,
        timeout = 2,
    })
end

function ReadestSync:onAddToReadest(file)
    self:addToReadest(file)
end

-- ── Menu ───────────────────────────────────────────────────────────

function ReadestSync:addToMainMenu(menu_items)
    menu_items.readest_sync = {
        sorting_hint = "tools",
        text = _("Readest"),
        sub_item_table = {
            {
                text_func = function()
                    return SyncAuth:needsLogin(self.settings) and _("Log in Readest Account")
                        or T(_("Log out as %1"), self.settings.user_name or "")
                end,
                callback_func = function()
                    if SyncAuth:needsLogin(self.settings) then
                        return function(menu)
                            SyncAuth:login(self.settings, self.path, self.title, menu)
                        end
                    else
                        return function(menu)
                            SyncAuth:logout(self.settings, self.path, menu)
                        end
                    end
                end,
            },
            {
                text = _("Auto sync"),
                checked_func = function() return self.settings.auto_sync end,
                callback = function()
                    self:onReadestSyncToggleAutoSync()
                end,
                separator = true,
            },
            {
                text = _("Readest library"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.settings.user_id ~= nil
                end,
                callback = function()
                    self:openLibrary()
                end,
            },
            {
                text = _("Push books now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.settings.user_id ~= nil
                end,
                callback = function()
                    self:syncBooksLibrary("push", true)
                end,
            },
            {
                text = _("Pull books now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.settings.user_id ~= nil
                end,
                callback = function()
                    self:syncBooksLibrary("pull", true)
                end,
                separator = true,
            },
            {
                text = _("Push reading progress now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pushBookConfig(true)
                end,
            },
            {
                text = _("Pull reading progress now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pullBookConfig(true)
                end,
                separator = true,
            },
            {
                text = _("Push annotations now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pushBookNotes(true)
                end,
            },
            {
                text = _("Pull annotations now"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:pullBookNotes(true)
                end,
            },
            {
                text = _("Full sync all annotations"),
                enabled_func = function()
                    return self.settings.access_token ~= nil and self.ui.document ~= nil
                end,
                callback = function()
                    self:fullSyncBookNotes()
                end,
                separator = true,
            },
            {
                text = _("Sync info"),
                enabled_func = function()
                    return self.ui.document ~= nil
                end,
                callback = function()
                    self:showSyncInfo()
                end,
                separator = true,
            },
            {
                text_func = function()
                    if self.installed_version then
                        return T(_("Check for update (v%1)"), self.installed_version)
                    end
                    return _("Check for update")
                end,
                callback = function()
                    SelfUpdate:checkForUpdate(self.path, self.installed_version)
                end,
            },
        }
    }
end

-- ── Sync helpers (thin wrappers around modules) ────────────────────

function ReadestSync:ensureClient(interactive)
    if not self.settings.access_token or not self.settings.user_id then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please login first"),
                timeout = 2,
            })
        end
        return nil
    end

    SyncAuth:tryRefreshToken(self.settings, self.path)

    local client = SyncAuth:getReadestSyncClient(self.settings, self.path)
    if not client then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Please configure Readest settings first"),
                timeout = 3,
            })
        end
        return nil
    end
    return client
end

function ReadestSync:getBookIdentifiers()
    local book_hash = SyncConfig:getDocumentIdentifier(self.ui)
    local meta_hash = SyncConfig:getMetaHash(self.ui)
    return book_hash, meta_hash
end

function ReadestSync:showSyncInfo()
    if not self.ui.document then
        UIManager:show(InfoMessage:new{
            text = _("No book is open"),
            timeout = 2,
        })
        return
    end

    local info = SyncConfig:getMetadataHashInfo(self.ui)
    local doc_readest_sync = self.ui.doc_settings:readSetting("readest_sync") or {}
    local stored_meta_hash = doc_readest_sync.meta_hash_v1
    local placeholder = _("(none)")

    local last_synced_at = math.max(
        doc_readest_sync.last_synced_at_config or 0,
        doc_readest_sync.last_synced_at_notes or 0
    )
    local last_synced_label = last_synced_at > 0
        and os.date("%Y-%m-%d %H:%M", last_synced_at)
        or _("Never synced")

    local kv_pairs = {
        { _("Book Fingerprint"), stored_meta_hash or info.meta_hash },
    }
    table.insert(kv_pairs, { _("Title"), info.title ~= "" and info.title or placeholder })
    table.insert(kv_pairs, {
        _("Author"),
        #info.authors > 0 and table.concat(info.authors, ", ") or placeholder,
    })
    table.insert(kv_pairs, {
        _("Identifiers"),
        #info.identifiers > 0 and table.concat(info.identifiers, ", ") or placeholder,
    })
    table.insert(kv_pairs, { _("Last Synced"), last_synced_label })

    UIManager:show(KeyValuePage:new{
        title = _("Sync Info"),
        kv_pairs = kv_pairs,
    })
end

-- ── Config sync ────────────────────────────────────────────────────

function ReadestSync:pushBookConfig(interactive)
    local now = os.time()
    if not interactive and now - self.last_sync_timestamp <= API_CALL_DEBOUNCE_DELAY then
        return
    end

    if interactive and NetworkMgr:willRerunWhenOnline(function() self:pushBookConfig(interactive) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    self.last_sync_timestamp = SyncConfig:push(
        self.ui, self.settings, client, interactive, self.last_sync_timestamp
    )
end

function ReadestSync:pullBookConfig(interactive)
    local book_hash, meta_hash = self:getBookIdentifiers()
    if not book_hash or not meta_hash then return end

    if NetworkMgr:willRerunWhenOnline(function() self:pullBookConfig(interactive) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    SyncConfig:pull(
        self.ui, self.settings, client, book_hash, meta_hash, interactive,
        function() SyncAuth:logout(self.settings, self.path) end
    )
end

-- ── Annotation sync ────────────────────────────────────────────────

function ReadestSync:pushBookNotes(interactive, full_sync)
    if interactive and NetworkMgr:willRerunWhenOnline(function() self:pushBookNotes(interactive, full_sync) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    SyncAnnotations:push(self.ui, self.settings, client, interactive, full_sync)
end

function ReadestSync:pullBookNotes(interactive, full_sync)
    local book_hash, meta_hash = self:getBookIdentifiers()
    if not book_hash or not meta_hash then return end

    if NetworkMgr:willRerunWhenOnline(function() self:pullBookNotes(interactive, full_sync) end) then
        return
    end

    local client = self:ensureClient(interactive)
    if not client then return end

    SyncAnnotations:pull(
        self.ui, self.settings, client, book_hash, meta_hash, self.dialog, interactive, full_sync
    )
end

function ReadestSync:fullSyncBookNotes()
    -- Push all annotations first, then pull all
    self:pushBookNotes(true, true)
    self:pullBookNotes(true, true)
end

-- ── Event handlers ─────────────────────────────────────────────────

function ReadestSync:onReadestSyncToggleAutoSync(toggle)
    if toggle == self.settings.auto_sync then
        return true
    end
    self.settings.auto_sync = not self.settings.auto_sync
    G_reader_settings:saveSetting("readest_sync", self.settings)
    if self.settings.auto_sync and self.ui.document then
        self:pullBookConfig(false)
    end
end

function ReadestSync:onReadestSyncPushProgress()
    self:pushBookConfig(true)
end

function ReadestSync:onReadestSyncPullProgress()
    self:pullBookConfig(true)
end

function ReadestSync:onReadestSyncPushAnnotations()
    self:pushBookNotes(true)
end

function ReadestSync:onReadestSyncPullAnnotations()
    self:pullBookNotes(true)
end

function ReadestSync:openLibrary()
    if not self.settings.access_token or not self.settings.user_id then
        UIManager:show(InfoMessage:new{ text = _("Please login first"), timeout = 2 })
        return
    end
    local LibraryWidget = require("library.librarywidget")
    LibraryWidget.open({
        settings  = self.settings,
        sync_path = self.path,
        sync_auth = SyncAuth,
    })
end

function ReadestSync:onReadestOpenLibrary()
    self:openLibrary()
end

-- Lazy-open a LibraryStore for the current user. The Library widget may
-- already have one open via librarywidget._store; we share it when present
-- to avoid two SQLite handles to the same file. Returns nil if user_id
-- isn't set (shouldn't happen — caller should gate on access_token).
function ReadestSync:getLibraryStore()
    if not self.settings.user_id or self.settings.user_id == "" then return nil end
    local LibraryWidget = require("library.librarywidget")
    if LibraryWidget._store and LibraryWidget._current_user == self.settings.user_id then
        return LibraryWidget._store
    end
    if self.library_store and self.library_store.user_id == self.settings.user_id then
        return self.library_store
    end
    if self.library_store then self.library_store:close() end
    local LibraryStore = require("library.librarystore")
    local DataStorage  = require("datastorage")
    self.library_store = LibraryStore.new({
        user_id = self.settings.user_id,
        db_path = DataStorage:getSettingsDir() .. "/readest_library.sqlite3",
    })
    return self.library_store
end

-- Bump updated_at + last_read_at on the local row for the currently-open
-- book. Called before a sync push so the row's timestamp is fresh. Returns
-- the touched row, or nil if there's nothing to touch (no book open, no
-- partial_md5, or hash not in the LibraryStore index).
function ReadestSync:touchOpenBook()
    if not self.ui or not self.ui.doc_settings then return nil end
    local hash = self.ui.doc_settings:readSetting("partial_md5_checksum")
    if not hash or hash == "" then return nil end

    local store = self:getLibraryStore()
    if not store then return nil end

    local progress_lib
    if self.ui.document and self.ui.document.getPageCount and self.ui.getCurrentPage then
        local cur = self.ui:getCurrentPage()
        local total = self.ui.document:getPageCount()
        if cur and total then
            progress_lib = require("json").encode({ cur, total })
        end
    end

    local touched = store:touchBook(hash, { progress_lib = progress_lib })
    if not touched then
        logger.dbg("ReadestSync touchOpenBook: no row for " .. hash
            .. " (book not in LibraryStore index)")
    end
    return touched
end

-- syncBooksLibrary(mode, interactive) — bidirectional book-row sync,
-- mirroring useBooksSync.handleAutoSync at apps/readest-app/src/app/
-- library/hooks/useBooksSync.ts:66-78. mode: "push"|"pull"|"both".
-- Touches the currently-open book first so its updated_at gets included
-- in the push delta. Interactive=true shows toast feedback.
function ReadestSync:syncBooksLibrary(mode, interactive)
    if not self.settings.access_token or not self.settings.user_id then
        if interactive then
            UIManager:show(InfoMessage:new{ text = _("Please login first"), timeout = 2 })
        end
        return
    end
    local store = self:getLibraryStore()
    if not store then
        if interactive then
            UIManager:show(InfoMessage:new{ text = _("Library not initialized"), timeout = 2 })
        end
        return
    end

    if mode ~= "pull" then
        -- Touch only matters for push (and 'both' which includes push)
        self:touchOpenBook()
    end

    local syncbooks = require("library.syncbooks")
    syncbooks.syncBooks({
        sync_auth = SyncAuth,
        sync_path = self.path,
        settings  = self.settings,
        store     = store,
    }, mode, function(success, msg, status)
        logger.info("ReadestSync syncBooksLibrary[" .. mode .. "] done: success="
            .. tostring(success) .. " msg=" .. tostring(msg))
        if interactive then
            UIManager:show(InfoMessage:new{
                text = success
                    and _("Books synced")
                    or _("Books sync failed"),
                timeout = 2,
            })
        end
        -- If the Library widget is open, refresh it so newly-pulled rows show
        local LibraryWidget = require("library.librarywidget")
        if LibraryWidget._menu then LibraryWidget.refresh() end
    end)
end

function ReadestSync:onCloseDocument()
    if self.settings.auto_sync and self.settings.access_token then
        NetworkMgr:goOnlineToRun(function()
            self:pushBookConfig(false)
            self:pushBookNotes(false)
            self:syncBooksLibrary("both", false)
        end)
    end
end

function ReadestSync:onReadestPushBooks()
    self:syncBooksLibrary("push", true)
end

function ReadestSync:onReadestPullBooks()
    self:syncBooksLibrary("pull", true)
end

function ReadestSync:onPageUpdate(page)
    if self.settings.auto_sync and self.settings.access_token and page then
        if self.delayed_push_task then
            UIManager:unschedule(self.delayed_push_task)
        end
        self.delayed_push_task = function()
            self:pushBookConfig(false)
        end
        UIManager:scheduleIn(5, self.delayed_push_task)
    end
end

function ReadestSync:onAnnotationsModified()
    if self.settings.auto_sync and self.settings.access_token then
        UIManager:nextTick(function()
            self:pushBookNotes(false)
        end)
    end
end

function ReadestSync:onCloseWidget()
    if self.delayed_push_task then
        UIManager:unschedule(self.delayed_push_task)
        self.delayed_push_task = nil
    end
end

function ReadestSync:deletePluginSettings()
    G_reader_settings:delSetting("readest_sync")
    self.settings = self.default_settings
    return true
end

return ReadestSync
