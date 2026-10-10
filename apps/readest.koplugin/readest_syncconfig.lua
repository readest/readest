local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local util = require("util")
local sha2 = require("ffi/sha2")
local SyncError = require("readest_syncerror")
local _ = require("readest_i18n")

local SyncConfig = {}
local push_sequences = setmetatable({}, { __mode = "k" })

-- Readest md5s the NFC-normalized hash source (book.ts getMetadataHashInfo);
-- utf8proc ships with KOReader but not with the spec harness, so fall back
-- to identity when it is unavailable.
local ok_utf8proc, Utf8Proc = pcall(require, "ffi/utf8proc")
local normalize_nfc = (ok_utf8proc and type(Utf8Proc.normalize_NFC) == "function")
    and Utf8Proc.normalize_NFC
    or function(s) return s end

local function normalizeIdentifier(identifier)
    if identifier:match("urn:") then
        return identifier:match("([^:]+)$")
    elseif identifier:match(":") then
        return identifier:match("^[^:]+:(.+)$")
    end
    return identifier
end

local function normalizeAuthor(author)
    author = author:gsub("^%s*(.-)%s*$", "%1")
    return author
end

-- Builds the cross-device book fingerprint from sidecar metadata. MUST stay
-- consistent with getMetadataHashInfo in apps/readest-app/src/utils/book.ts:
-- the md5 of hash_source is the identity that book rows, configs and notes
-- sync under, so any divergence forks a book's progress across devices.
function SyncConfig:computeMetadataHashInfo(doc_props, doc_path)
    doc_props = doc_props or {}
    local _dir, filename = util.splitFilePathName(doc_path or '')
    local basename, suffix = util.splitFileNameSuffix(filename)

    local title = doc_props.title or ''
    if title == '' then
        title = basename or ''
    end

    local authors_raw = doc_props.authors or ''
    local authors_list = {}
    if authors_raw:find("\n") then
        local list = util.splitToArray(authors_raw, "\n")
        for i, author in ipairs(list) do
            authors_list[i] = normalizeAuthor(author)
        end
    elseif authors_raw ~= '' then
        authors_list = { normalizeAuthor(authors_raw) }
    end

    local identifiers_raw = doc_props.identifiers or ''
    local identifiers_list = {}
    if identifiers_raw:find("\n") then
        local list = util.splitToArray(identifiers_raw, "\n")
        local normalized = {}
        for i, id in ipairs(list) do
            normalized[i] = normalizeIdentifier(id)
        end
        -- Scheme priority mirrors Readest's getPreferredIdentifier: uuid
        -- beats calibre beats isbn, regardless of listing order.
        local preferred = nil
        for _, scheme in ipairs({ "uuid", "calibre", "isbn" }) do
            for i, id in ipairs(list) do
                if id:lower():find(scheme, 1, true) then
                    preferred = normalized[i]
                    break
                end
            end
            if preferred then break end
        end
        if preferred then
            identifiers_list = { preferred }
        else
            identifiers_list = normalized
        end
    elseif identifiers_raw ~= '' then
        identifiers_list = { normalizeIdentifier(identifiers_raw) }
    end

    local hash_source = title .. "|" .. table.concat(authors_list, ",") .. "|" .. table.concat(identifiers_list, ",")
    -- PDF metadata is often generic boilerplate (every PowerPoint export is
    -- titled "PowerPoint Presentation"), so Readest salts PDF hashes with the
    -- import filename (issue #5411). Salt with ours the same way.
    if suffix and suffix:lower() == "pdf" then
        hash_source = hash_source .. "|" .. basename
    end
    return {
        title = title,
        authors = authors_list,
        identifiers = identifiers_list,
        hash_source = hash_source,
        meta_hash = sha2.md5(normalize_nfc(hash_source)),
    }
end

function SyncConfig:getMetadataHashInfo(ui)
    return self:computeMetadataHashInfo(
        ui.doc_settings:readSetting("doc_props"),
        ui.doc_settings:readSetting("doc_path")
    )
end

function SyncConfig:generateMetadataHash(ui)
    return self:getMetadataHashInfo(ui).meta_hash
end

function SyncConfig:getMetaHash(ui, store)
    local doc_readest_sync = ui.doc_settings:readSetting("readest_sync") or {}
    -- The value stamped when the book first entered the fleet is the
    -- authoritative one: Readest never recomputes a PDF's metaHash after
    -- import (the filename salt is unrecoverable there), so a synced library
    -- row must beat anything computed or cached locally.
    local meta_hash
    if store then
        local book_hash = self:getDocumentIdentifier(ui)
        local row = book_hash and store:_getRowRaw(book_hash)
        if row and row.meta_hash and row.meta_hash ~= "" then
            meta_hash = row.meta_hash
        end
    end
    meta_hash = meta_hash or doc_readest_sync.meta_hash_v1
    if not meta_hash then
        meta_hash = self:generateMetadataHash(ui)
    end
    -- Annotation flows read meta_hash_v1 straight from the sidecar, so the
    -- resolved value must land there whichever branch produced it.
    if meta_hash and doc_readest_sync.meta_hash_v1 ~= meta_hash then
        doc_readest_sync.meta_hash_v1 = meta_hash
        ui.doc_settings:saveSetting("readest_sync", doc_readest_sync)
    end
    return meta_hash
end

function SyncConfig:getDocumentIdentifier(ui)
    return ui.doc_settings:readSetting("partial_md5_checksum")
end

-- Build the sync payload for the open book: its hashes, current page and
-- page count, plus the xpointer for reflowable documents. Returns nil if
-- the book can't be identified.
function SyncConfig:getCurrentBookConfig(ui, store)
    local book_hash = self:getDocumentIdentifier(ui)
    local meta_hash = self:getMetaHash(ui, store)
    if not book_hash or not meta_hash then
        UIManager:show(InfoMessage:new{
            text = _("Cannot identify the current book"),
            timeout = 2,
        })
        return nil
    end

    local now = os.time() * 1000
    local clock = (ui.doc_settings:readSetting("readest_sync") or {}).config_clock
    -- Order local pushes within the same second, but discard clocks carried
    -- forward from a future server record or a corrected device clock.
    if type(clock) ~= "number" or clock < now or clock >= now + 1000 then clock = now - 1 end
    local config = {
        bookHash = book_hash,
        metaHash = meta_hash,
        progress = "",
        xpointer = "",
        updatedAt = clock + 1,
    }

    local current_page = ui:getCurrentPage()
    local page_count = ui.document:getPageCount()
    config.progress = {current_page, page_count}

    if not ui.document.info.has_pages then
        config.xpointer = ui.rolling:getLastProgress()
    end

    return config
end

-- Automatic pulls only advance; an explicit pull may also go backward, but
-- only to an exact position: a trimmed xpointer resolves to a parent node,
-- which orders before the local position and would jump to a chapter start.
-- Paged documents compare page numbers, reflowable ones compare xpointers,
-- trimming the remote xpointer until it resolves in the local document.
-- Skip positions that can't be parsed or resolved (e.g. a different copy
-- of the book) instead of erroring.
function SyncConfig:applyBookConfig(ui, config, interactive)
    logger.dbg("ReadestSync: Applying book config:", config)
    local xpointer = config.xpointer
    local progress = config.progress
    local has_pages = ui.document.info.has_pages
    local progress_pattern = "^%[%s*(%d+)%s*,%s*(%d+)%s*%]$"
    if has_pages and type(progress) == "table" then
        progress = string.format("[%s,%s]", tostring(progress[1]), tostring(progress[2]))
    end
    if has_pages and type(progress) == "string" then
        local page, _total_pages = progress:match(progress_pattern)
        local current_page = ui:getCurrentPage()
        local new_page = tonumber(page)
        if not new_page or new_page < 1 or new_page > ui.document:getPageCount() then return false end
        if new_page ~= current_page and (interactive or new_page > current_page) then
            ui.link:addCurrentLocationToStack()
            ui:handleEvent(Event:new("GotoPage", new_page))
            self:showSyncedMessage()
            return true
        end
    end
    if not has_pages and type(xpointer) == "string" and xpointer ~= "" then
        local last_xpointer = ui.rolling:getLastProgress()
        local working_xpointer = xpointer
        local function compare(pointer)
            local ok, result = pcall(ui.document.compareXPointers, ui.document, last_xpointer, pointer)
            return ok and result or nil
        end
        local cmp_result = compare(working_xpointer)
        while cmp_result == nil and working_xpointer do
            local last_slash_pos = working_xpointer:match("^.*()/")
            -- Stop above /body: the document root resolves in any book.
            if last_slash_pos and last_slash_pos > 1
                    and working_xpointer:sub(1, last_slash_pos - 1) ~= "/body" then
                working_xpointer = working_xpointer:sub(1, last_slash_pos - 1)
                cmp_result = compare(working_xpointer)
            else
                break
            end
        end
        if cmp_result and (cmp_result > 0
                or (interactive and cmp_result < 0 and working_xpointer == xpointer)) then
            ui.link:addCurrentLocationToStack()
            ui:handleEvent(Event:new("GotoXPointer", working_xpointer))
            self:showSyncedMessage()
            return true
        end
        return cmp_result ~= nil
    end
    return has_pages and type(progress) == "string" and progress:match(progress_pattern) ~= nil
end

function SyncConfig:showSyncedMessage()
    UIManager:show(InfoMessage:new{
        text = _("Progress has been synchronized."),
        timeout = 3,
    })
end

function SyncConfig:push(ui, settings, client, interactive, last_sync_timestamp, done, store)
    local config = self:getCurrentBookConfig(ui, store)
    if not config then return last_sync_timestamp end

    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pushing reading progress..."),
            timeout = 1,
        })
    end

    local doc_settings = ui.doc_settings
    push_sequences[doc_settings] = (push_sequences[doc_settings] or 0) + 1
    local sequence = push_sequences[doc_settings]
    local state = doc_settings:readSetting("readest_sync") or {}
    state.config_clock = config.updatedAt
    doc_settings:saveSetting("readest_sync", state)
    local payload = {
        books = {},
        notes = {},
        configs = { config },
    }

    local function receive(success, response, status)
        -- Only the latest push may update completion state or request a retry
        -- through `done`. A successful merge may keep another device's newer
        -- position; its timestamp alone cannot prove clock skew, so respect it.
        if push_sequences[doc_settings] ~= sequence then return end
        if interactive and not (type(response) == "table" and response.auth_required) then
            if success then
                UIManager:show(InfoMessage:new{
                    text = _("Reading progress pushed successfully"),
                    timeout = 2,
                })
            else
                UIManager:show(InfoMessage:new{
                    text = SyncError.withDetail(_("Failed to push reading progress"), response, status),
                    timeout = 5,
                })
            end
        end
        if success and doc_settings then
            local doc_readest_sync = doc_settings:readSetting("readest_sync") or {}
            doc_readest_sync.last_synced_at_config = os.time()
            doc_settings:saveSetting("readest_sync", doc_readest_sync)
        end
        if done then done(success) end
    end
    client:pushChanges(payload, receive)

    if not interactive then
        return os.time()
    end
    return last_sync_timestamp
end

function SyncConfig:pull(ui, settings, client, book_hash, meta_hash, interactive)
    local document = ui.document
    -- ReaderRolling keeps its logical XPointer during rerendering. Page
    -- numbers change with the layout and cannot detect EPUB navigation.
    local has_pages = document.info and document.info.has_pages
    local position = has_pages and ui.getCurrentPage and ui:getCurrentPage()
        or (ui.rolling and ui.rolling:getLastProgress())
    local function moved()
        if not position or position == "" then return false end -- initial layout has no position yet
        if has_pages then return ui:getCurrentPage() ~= position end
        local current = ui.rolling and ui.rolling:getLastProgress()
        if current == position then return false end
        if not current then return true end
        local ok, cmp = pcall(document.compareXPointers, document, position, current)
        return not ok or cmp ~= 0
    end
    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pulling reading progress..."),
            timeout = 1,
        })
    end

    client:pullChanges(
        {
            since = 0,
            type = "configs",
            book = book_hash,
            meta_hash = meta_hash,
        },
        function(success, response, status)
            if ui.document ~= document then return end -- book closed while the request was running
            if not success then
                if type(response) == "table" and response.auth_required then return end -- auth wrapper owns the prompt
                if interactive then
                    UIManager:show(InfoMessage:new{
                        text = SyncError.withDetail(_("Failed to pull reading progress"), response, status),
                        timeout = 5,
                    })
                end
                return
            end

            if ui.doc_settings then
                local doc_readest_sync = ui.doc_settings:readSetting("readest_sync") or {}
                doc_readest_sync.last_synced_at_config = os.time()
                ui.doc_settings:saveSetting("readest_sync", doc_readest_sync)
            end

            local data = type(response) == "table" and response.configs
            if data and #data > 0 then
                local config = data[1]
                if config then
                    if not interactive and moved() then return end
                    local applied = self:applyBookConfig(ui, config, interactive)
                    if interactive then
                        UIManager:show(InfoMessage:new{
                            text = applied and _("Reading progress synchronized")
                                or _("Saved reading position cannot be used with this copy of the book"),
                            timeout = 2,
                        })
                    end
                    return
                end
            end

            if interactive then
                UIManager:show(InfoMessage:new{
                    text = _("No saved reading progress found for this book"),
                    timeout = 2,
                })
            end
        end
    )
end

return SyncConfig
