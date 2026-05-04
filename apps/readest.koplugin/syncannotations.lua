local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local sha2 = require("ffi/sha2")
local T = require("ffi/util").template
local _ = require("i18n")

local SyncAnnotations = {}

-- KOReader color name → Readest color value
local KO_TO_READEST_COLOR = {
    yellow = "yellow",
    red = "red",
    green = "green",
    blue = "blue",
    purple = "violet",
    orange = "#ff8800",
    cyan = "#00bcd4",
    olive = "#808000",
    gray = "#9e9e9e",
}

-- Readest color value → KOReader color name
local READEST_TO_KO_COLOR = {
    yellow = "yellow",
    red = "red",
    green = "green",
    blue = "blue",
    violet = "purple",
    ["#ff8800"] = "orange",
    ["#00bcd4"] = "cyan",
    ["#808000"] = "olive",
    ["#9e9e9e"] = "gray",
}

function SyncAnnotations:parseDatetimeToMs(dt)
    if not dt then return os.time() * 1000 end
    local y, m, d, h, min, s = dt:match("(%d+)-(%d+)-(%d+) (%d+):(%d+):(%d+)")
    if y then
        return os.time({
            year = tonumber(y), month = tonumber(m), day = tonumber(d),
            hour = tonumber(h), min = tonumber(min), sec = tonumber(s),
        }) * 1000
    end
    return os.time() * 1000
end

function SyncAnnotations:parseISODatetime(dt)
    if not dt then return os.time() end
    local y, m, d, h, min, s = dt:match("(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
    if y then
        return os.time({
            year = tonumber(y), month = tonumber(m), day = tonumber(d),
            hour = tonumber(h), min = tonumber(min), sec = tonumber(s),
        })
    end
    return os.time()
end

function SyncAnnotations:generateNoteId(book_hash, note_type, pos0, pos1)
    local raw = "ko:" .. book_hash .. ":" .. note_type .. ":" .. (pos0 or "") .. ":" .. (pos1 or "")
    return sha2.md5(raw):sub(1, 7)
end

function SyncAnnotations:getAnnotations(ui, settings, book_hash, meta_hash, full_sync)
    local annotations = ui.annotation and ui.annotation.annotations
    if not annotations then return {} end

    local last_sync = full_sync and 0 or (settings.last_notes_sync_at or 0)

    local notes = {}
    for _, item in ipairs(annotations) do
        local updated_at = self:parseDatetimeToMs(item.datetime_updated or item.datetime)
        if updated_at <= last_sync then
            goto skip
        end

        local pos0 = item.pos0
        local pos1 = item.pos1
        if type(pos0) == "table" then pos0 = nil end
        if type(pos1) == "table" then pos1 = nil end

        if item.drawer and pos0 then
            -- Annotation (highlight/underline/strikeout): has drawer and pos0/pos1
            local style = "highlight"
            if item.drawer == "underscore" then
                style = "underline"
            elseif item.drawer == "strikeout" then
                style = "squiggly"
            end

            local id = item.id or self:generateNoteId(book_hash, "annotation", tostring(pos0), pos1 and tostring(pos1))
            table.insert(notes, {
                bookHash = book_hash,
                metaHash = meta_hash,
                id = id,
                type = "annotation",
                xpointer0 = tostring(pos0),
                xpointer1 = pos1 and tostring(pos1) or nil,
                text = item.text or "",
                note = item.note or "",
                style = style,
                color = KO_TO_READEST_COLOR[item.color or "yellow"],
                page = item.pageno,
                createdAt = self:parseDatetimeToMs(item.datetime),
                updatedAt = updated_at,
            })
        elseif not item.drawer and type(item.page) == "string" then
            -- Bookmark: no drawer, position in page field (xpointer string)
            local page_xp = item.page
            local id = item.id or self:generateNoteId(book_hash, "bookmark", page_xp)
            table.insert(notes, {
                bookHash = book_hash,
                metaHash = meta_hash,
                id = id,
                type = "bookmark",
                xpointer0 = page_xp,
                text = item.text or "",
                note = item.note or "",
                page = item.pageno,
                createdAt = self:parseDatetimeToMs(item.datetime),
                updatedAt = updated_at,
            })
        end
        ::skip::
    end
    return notes
end

function SyncAnnotations:push(ui, settings, client, interactive, full_sync)
    local book_hash = ui.doc_settings:readSetting("partial_md5_checksum")
    local meta_hash = ui.doc_settings:readSetting("readest_sync") or {}
    meta_hash = meta_hash.meta_hash_v1
    if not book_hash or not meta_hash then return end

    local annotations = self:getAnnotations(ui, settings, book_hash, meta_hash, full_sync)
    if #annotations == 0 then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("No annotations to push"),
                timeout = 2,
            })
        end
        return
    end

    if interactive then
        UIManager:show(InfoMessage:new{
            text = _("Pushing annotations..."),
            timeout = 1,
        })
    end

    local payload = {
        books = {},
        notes = annotations,
        configs = {},
    }
    logger.dbg("ReadestSync: Pushing annotations, payload:", payload)

    client:pushChanges(
        payload,
        function(success, _response)
            if interactive then
                if success then
                    UIManager:show(InfoMessage:new{
                        text = T(_("%1 annotations pushed successfully"), #annotations),
                        timeout = 2,
                    })
                else
                    UIManager:show(InfoMessage:new{
                        text = _("Failed to push annotations"),
                        timeout = 2,
                    })
                end
            end
            if success then
                settings.last_notes_sync_at = os.time() * 1000
                G_reader_settings:saveSetting("readest_sync", settings)
                if ui.doc_settings then
                    local doc_readest_sync = ui.doc_settings:readSetting("readest_sync") or {}
                    doc_readest_sync.last_synced_at_notes = os.time()
                    ui.doc_settings:saveSetting("readest_sync", doc_readest_sync)
                end
            end
        end
    )
end

function SyncAnnotations:pull(ui, settings, client, book_hash, meta_hash, dialog, interactive, full_sync)
    if ui.document.info.has_pages then
        if interactive then
            UIManager:show(InfoMessage:new{
                text = _("Annotation sync is not supported for PDF documents"),
                timeout = 3,
            })
        end
        return
    end

    if interactive then
        UIManager:show(InfoMessage:new{
            text = full_sync and _("Full sync: pulling all annotations...") or _("Pulling annotations..."),
            timeout = 1,
        })
    end

    client:pullChanges(
        {
            since = full_sync and 0 or (settings.last_notes_sync_at or 0),
            type = "notes",
            book = book_hash,
            meta_hash = meta_hash,
        },
        function(success, response, status)
            if not success then
                -- Treat HTTP 401/403 as auth failure regardless of body shape
                -- so a future server tweak to the error string doesn't
                -- silently turn relogin into "Failed to pull annotations"
                -- noise (codex round 1 finding 15).
                local is_auth_fail = status == 401 or status == 403
                    or (response and response.error == "Not authenticated")
                if interactive then
                    UIManager:show(InfoMessage:new{
                        text = is_auth_fail
                            and _("Authentication failed, please login again")
                            or _("Failed to pull annotations"),
                        timeout = 2,
                    })
                end
                return
            end

            local data = response.notes
            if not data or #data == 0 then
                if interactive then
                    UIManager:show(InfoMessage:new{
                        text = _("No new annotations found"),
                        timeout = 2,
                    })
                end
                return
            end

            logger.dbg("ReadestSync: Pulled annotations from sync:", #data)
            local annotation_mgr = ui.annotation
            if not annotation_mgr then return end

            -- Build dedup sets: by ID, by pos0|pos1 for annotations, by page xpointer for bookmarks
            local existing_ids = {}
            local existing_annotations = {}
            local existing_bookmarks = {}
            for _, item in ipairs(annotation_mgr.annotations) do
                -- Use stored id if available
                if item.id then
                    existing_ids[item.id] = true
                end
                if item.drawer then
                    local pos0 = item.pos0
                    local pos1 = item.pos1
                    if type(pos0) == "table" then pos0 = nil end
                    if type(pos1) == "table" then pos1 = nil end
                    local key = tostring(pos0) .. "|" .. tostring(pos1 or "")
                    existing_annotations[key] = true
                    -- Also generate ID for annotations without id
                    if not item.id and pos0 then
                        local id = self:generateNoteId(book_hash, "annotation", tostring(pos0), pos1 and tostring(pos1))
                        existing_ids[id] = true
                    end
                elseif type(item.page) == "string" then
                    existing_bookmarks[item.page] = true
                    if not item.id then
                        local id = self:generateNoteId(book_hash, "bookmark", item.page)
                        existing_ids[id] = true
                    end
                end
            end

            local added = 0
            for _, note in ipairs(data) do
                if note.deleted_at then
                    goto continue
                end

                local xp0 = note.xpointer0
                if not xp0 then goto continue end

                -- Deduplicate by server-provided ID
                if note.id and existing_ids[note.id] then goto continue end

                local note_type = note.type
                local item

                local created = self:parseISODatetime(note.created_at)
                local updated = self:parseISODatetime(note.updated_at) or created
                local datetime_str = os.date("%Y-%m-%d %H:%M:%S", created)
                local datetime_updated_str = os.date("%Y-%m-%d %H:%M:%S", updated)

                -- Resolve KOReader page number from xpointer
                local pageno = ui.document:getPageFromXPointer(xp0) or note.page

                if note_type == "bookmark" then
                    if existing_bookmarks[xp0] then goto continue end

                    item = {
                        id = note.id,
                        page = xp0,
                        text = note.text or "",
                        note = note.note or "",
                        pageno = pageno,
                        datetime = datetime_str,
                        datetime_updated = datetime_updated_str,
                    }
                    existing_bookmarks[xp0] = true
                else
                    local xp1 = note.xpointer1
                    local key = xp0 .. "|" .. (xp1 or "")
                    if existing_annotations[key] then goto continue end

                    local drawer = "lighten"
                    if note.style == "underline" then
                        drawer = "underscore"
                    elseif note.style == "squiggly" then
                        drawer = "strikeout"
                    end

                    item = {
                        id = note.id,
                        pos0 = xp0,
                        pos1 = xp1 or xp0,
                        page = xp0,
                        text = note.text or "",
                        note = note.note or "",
                        drawer = drawer,
                        color = READEST_TO_KO_COLOR[note.color] or "yellow",
                        pageno = pageno,
                        datetime = datetime_str,
                        datetime_updated = datetime_updated_str,
                    }
                    existing_annotations[key] = true
                end

                local index = annotation_mgr:addItem(item)
                ui:handleEvent(Event:new("AnnotationsModified", { item, index_modified = index }))
                logger.dbg("ReadestSync: Added annotation from sync:", item)
                added = added + 1

                ::continue::
            end

            settings.last_notes_sync_at = os.time() * 1000
            G_reader_settings:saveSetting("readest_sync", settings)
            if ui.doc_settings then
                local doc_readest_sync = ui.doc_settings:readSetting("readest_sync") or {}
                doc_readest_sync.last_synced_at_notes = os.time()
                ui.doc_settings:saveSetting("readest_sync", doc_readest_sync)
            end

            if interactive then
                UIManager:show(InfoMessage:new{
                    text = T(_("%1 annotations pulled"), added),
                    timeout = 2,
                })
            end

            if added > 0 then
                UIManager:setDirty(dialog, "ui")
            end
        end
    )
end

return SyncAnnotations
