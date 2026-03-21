local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local util = require("util")
local sha2 = require("ffi/sha2")
local _ = require("gettext")

local SyncConfig = {}

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

function SyncConfig:generateMetadataHash(ui)
    local doc_props = ui.doc_settings:readSetting("doc_props") or {}
    local title = doc_props.title or ''
    if title == '' then
        local _doc_path, filename = util.splitFilePathName(ui.doc_settings:readSetting("doc_path") or '')
        local basename, _suffix = util.splitFileNameSuffix(filename)
        title = basename or ''
    end

    local authors = doc_props.authors or ''
    if authors:find("\n") then
        authors = util.splitToArray(authors, "\n")
        for i, author in ipairs(authors) do
            authors[i] = normalizeAuthor(author)
        end
        authors = table.concat(authors, ",")
    else
        authors = normalizeAuthor(authors)
    end

    local identifiers = doc_props.identifiers or ''
    if identifiers:find("\n") then
        local list = util.splitToArray(identifiers, "\n")
        local normalized = {}
        local priorities = { "uuid", "calibre", "isbn" }
        local preferred = nil
        for i, id in ipairs(list) do
            normalized[i] = normalizeIdentifier(id)
            local candidate = id:lower()
            for _, p in ipairs(priorities) do
                if candidate:find(p, 1, true) then
                    preferred = normalized[i]
                    break
                end
            end
        end
        if preferred then
            identifiers = preferred
        else
            identifiers = table.concat(normalized, ",")
        end
    else
        identifiers = normalizeIdentifier(identifiers)
    end
    local doc_meta = title .. "|" .. authors .. "|" .. identifiers
    return sha2.md5(doc_meta)
end

function SyncConfig:getMetaHash(ui)
    local doc_readest_sync = ui.doc_settings:readSetting("readest_sync") or {}
    local meta_hash = doc_readest_sync.meta_hash_v1
    if not meta_hash then
        meta_hash = self:generateMetadataHash(ui)
        doc_readest_sync.meta_hash_v1 = meta_hash
        ui.doc_settings:saveSetting("readest_sync", doc_readest_sync)
    end
    return meta_hash
end

function SyncConfig:getDocumentIdentifier(ui)
    return ui.doc_settings:readSetting("partial_md5_checksum")
end

function SyncConfig:getCurrentBookConfig(ui)
    local book_hash = self:getDocumentIdentifier(ui)
    local meta_hash = self:getMetaHash(ui)
    if not book_hash or not meta_hash then
        UIManager:show(InfoMessage:new{
            text = _("Cannot identify the current book"),
            timeout = 2,
        })
        return nil
    end

    local config = {
        bookHash = book_hash,
        metaHash = meta_hash,
        progress = "",
        xpointer = "",
        updatedAt = os.time() * 1000,
    }

    local current_page = ui:getCurrentPage()
    local page_count = ui.document:getPageCount()
    config.progress = {current_page, page_count}

    if not ui.document.info.has_pages then
        config.xpointer = ui.rolling:getLastProgress()
    end

    return config
end

function SyncConfig:applyBookConfig(ui, config)
    logger.dbg("ReadestSync: Applying book config:", config)
    local xpointer = config.xpointer
    local progress = config.progress
    local has_pages = ui.document.info.has_pages
    local progress_pattern = "^%[(%d+),(%d+)%]$"
    if has_pages and progress then
        local page, _total_pages = progress:match(progress_pattern)
        local current_page = ui:getCurrentPage()
        local new_page = tonumber(page)
        if new_page > current_page then
            ui.link:addCurrentLocationToStack()
            ui:handleEvent(Event:new("GotoPage", new_page))
            self:showSyncedMessage()
        end
    end
    if not has_pages and xpointer then
        local last_xpointer = ui.rolling:getLastProgress()
        local working_xpointer = xpointer
        local cmp_result = ui.document:compareXPointers(last_xpointer, working_xpointer)
        while cmp_result == nil and working_xpointer do
            local last_slash_pos = working_xpointer:match("^.*()/")
            if last_slash_pos and last_slash_pos > 1 then
                working_xpointer = working_xpointer:sub(1, last_slash_pos - 1)
                cmp_result = ui.document:compareXPointers(last_xpointer, working_xpointer)
            else
                break
            end
        end
        if cmp_result > 0 then
            ui.link:addCurrentLocationToStack()
            ui:handleEvent(Event:new("GotoXPointer", working_xpointer))
            self:showSyncedMessage()
        end
    end
end

function SyncConfig:showSyncedMessage()
    UIManager:show(InfoMessage:new{
        text = _("Progress has been synchronized."),
        timeout = 3,
    })
end

function SyncConfig:push(ui, settings, client, interactive, last_sync_timestamp)
    local config = self:getCurrentBookConfig(ui)
    if not config then return last_sync_timestamp end

    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pushing book config..."),
            timeout = 1,
        })
    end

    local payload = {
        books = {},
        notes = {},
        configs = { config },
    }

    client:pushChanges(
        payload,
        function(success, _response)
            if interactive then
                if success then
                    UIManager:show(InfoMessage:new{
                        text = _("Book config pushed successfully"),
                        timeout = 2,
                    })
                else
                    UIManager:show(InfoMessage:new{
                        text = _("Failed to push book config"),
                        timeout = 2,
                    })
                end
            end
        end
    )

    if not interactive then
        return os.time()
    end
    return last_sync_timestamp
end

function SyncConfig:pull(ui, settings, client, book_hash, meta_hash, interactive, logout_fn)
    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pulling book config..."),
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
        function(success, response)
            if not success then
                if response and response.error == "Not authenticated" then
                    if interactive then
                        UIManager:show(InfoMessage:new{
                            text = _("Authentication failed, please login again"),
                            timeout = 2,
                        })
                    end
                    if logout_fn then logout_fn() end
                    return
                end
                if interactive then
                    UIManager:show(InfoMessage:new{
                        text = _("Failed to pull book config"),
                        timeout = 2,
                    })
                end
                return
            end

            local data = response.configs
            if data and #data > 0 then
                local config = data[1]
                if config then
                    self:applyBookConfig(ui, config)
                    if interactive then
                        UIManager:show(InfoMessage:new{
                            text = _("Book config synchronized"),
                            timeout = 2,
                        })
                    end
                    return
                end
            end

            if interactive then
                UIManager:show(InfoMessage:new{
                    text = _("No saved config found for this book"),
                    timeout = 2,
                })
            end
        end
    )
end

return SyncConfig
