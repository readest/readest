local Event = require("ui/event")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local sha2 = require("ffi/sha2")
local T = require("ffi/util").template
local _ = require("gettext")

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

function SyncAnnotations:generateNoteId(book_hash, note_type, pos0, pos1)
    local raw = "ko:" .. book_hash .. ":" .. note_type .. ":" .. (pos0 or "") .. ":" .. (pos1 or "")
    return sha2.md5(raw):sub(1, 7)
end

function SyncAnnotations:getAnnotations(ui, settings, book_hash, meta_hash)
    local annotations = ui.annotation and ui.annotation.annotations
    if not annotations then return {} end

    local last_sync = settings.last_notes_sync_at or 0

    local notes = {}
    for _, item in ipairs(annotations) do
        local pos0 = item.pos0
        local pos1 = item.pos1
        if type(pos0) == "table" then pos0 = nil end
        if type(pos1) == "table" then pos1 = nil end
        if pos0 then
            local updated_at = self:parseDatetimeToMs(item.datetime_updated or item.datetime)
            if updated_at <= last_sync then
                goto skip
            end

            local note_type = item.drawer and "annotation" or "bookmark"
            local id = self:generateNoteId(book_hash, note_type, tostring(pos0), pos1 and tostring(pos1))
            local style = "highlight"
            if item.drawer == "underscore" then
                style = "underline"
            elseif item.drawer == "strikeout" then
                style = "squiggly"
            end

            local note = {
                bookHash = book_hash,
                metaHash = meta_hash,
                id = id,
                type = note_type,
                xpointer0 = tostring(pos0),
                xpointer1 = pos1 and tostring(pos1) or nil,
                text = item.text or "",
                note = item.note or "",
                style = note_type == "annotation" and style or nil,
                color = note_type == "annotation" and KO_TO_READEST_COLOR[item.color or "yellow"] or nil,
                page = item.pageno,
                createdAt = self:parseDatetimeToMs(item.datetime),
                updatedAt = updated_at,
            }

            table.insert(notes, note)
        end
        ::skip::
    end
    return notes
end

function SyncAnnotations:push(ui, settings, client, interactive)
    local book_hash = ui.doc_settings:readSetting("partial_md5_checksum")
    local meta_hash = ui.doc_settings:readSetting("readest_sync") or {}
    meta_hash = meta_hash.meta_hash_v1
    if not book_hash or not meta_hash then return end

    local annotations = self:getAnnotations(ui, settings, book_hash, meta_hash)
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
            end
        end
    )
end

function SyncAnnotations:pull(ui, settings, client, book_hash, meta_hash, dialog, interactive)
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
            text = _("Pulling annotations..."),
            timeout = 1,
        })
    end

    client:pullChanges(
        {
            since = settings.last_notes_sync_at or 0,
            type = "notes",
            book = book_hash,
            meta_hash = meta_hash,
        },
        function(success, response)
            if not success then
                if interactive then
                    UIManager:show(InfoMessage:new{
                        text = _("Failed to pull annotations"),
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

            logger.dbg("ReadestSync: Pulled annotations from sync:", data)
            local annotation_mgr = ui.annotation
            if not annotation_mgr then return end

            local existing_positions = {}
            for _, item in ipairs(annotation_mgr.annotations) do
                local key = tostring(item.pos0) .. "|" .. tostring(item.pos1 or "")
                existing_positions[key] = true
            end

            local added = 0
            for _, note in ipairs(data) do
                if note.deleted_at then
                    goto continue
                end

                local xp0 = note.xpointer0
                local xp1 = note.xpointer1
                if not xp0 then goto continue end

                local key = xp0 .. "|" .. (xp1 or "")
                if existing_positions[key] then goto continue end

                local drawer = "lighten"
                local note_type = note.type
                if note_type == "bookmark" then
                    drawer = nil
                elseif note.style == "underline" then
                    drawer = "underscore"
                elseif note.style == "squiggly" then
                    drawer = "strikeout"
                end

                local item = {
                    pos0 = xp0,
                    pos1 = xp1 or xp0,
                    page = xp0,
                    text = note.text or "",
                    note = note.note or "",
                    drawer = drawer,
                    color = READEST_TO_KO_COLOR[note.color] or "yellow",
                    pageno = note.page,
                    datetime = os.date("%Y-%m-%d %H:%M:%S"),
                }
                local index = annotation_mgr:addItem(item)
                ui:handleEvent(Event:new("AnnotationsModified", { item, index_modified = index }))
                logger.dbg("ReadestSync: Added annotation from sync:", item)
                existing_positions[key] = true
                added = added + 1

                ::continue::
            end

            settings.last_notes_sync_at = os.time() * 1000
            G_reader_settings:saveSetting("readest_sync", settings)

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
