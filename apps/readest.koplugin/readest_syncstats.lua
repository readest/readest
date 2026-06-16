local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local SQ3 = require("lua-ljsqlite3/init")
local _ = require("readest_i18n")

local SyncStats = {}

local function db_path()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

-- Read book md5/title/authors + page events with start_time > cursor.
function SyncStats:collectSince(cursor)
    local conn = SQ3.open(db_path())
    local books, pages, seen = {}, {}, {}
    local stmt = conn:prepare([[
        SELECT b.md5, b.title, b.authors, p.page, p.start_time, p.duration, p.total_pages
        FROM page_stat_data p JOIN book b ON b.id = p.id_book
        WHERE p.start_time > ? ORDER BY p.start_time ASC]])
    stmt:reset():bind(tonumber(cursor) or 0)
    local row = stmt:step()
    while row ~= nil do
        local md5 = row[1]
        if md5 and not seen[md5] then
            seen[md5] = true
            table.insert(books, { book_hash = md5, title = row[2] or "", authors = row[3] or "" })
        end
        table.insert(pages, {
            book_hash = md5,
            page = tonumber(row[4]),
            start_time = tonumber(row[5]),
            duration = tonumber(row[6]),
            total_pages = tonumber(row[7]),
        })
        row = stmt:step()
    end
    stmt:close()
    conn:close()
    return books, pages
end

-- Upsert pulled rows into the local statistics.sqlite3 (union / longer-duration).
function SyncStats:applyRemote(books, pages)
    local conn = SQ3.open(db_path())
    conn:exec("BEGIN;")
    local insert_book = conn:prepare("INSERT OR IGNORE INTO book (title, authors, md5) VALUES (?, ?, ?);")
    for _, b in ipairs(books or {}) do
        insert_book:reset():bind(b.title or "", b.authors or "", b.book_hash):step()
    end
    insert_book:close()
    local find_id = conn:prepare("SELECT id FROM book WHERE md5 = ? LIMIT 1;")
    local insert_page = conn:prepare([[
        INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id_book, page, start_time)
        DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages;]])
    local id_cache = {}
    local touched = {}
    for _, p in ipairs(pages or {}) do
        local id = id_cache[p.book_hash]
        if not id then
            local r = find_id:reset():bind(p.book_hash):step()
            if r ~= nil then id = tonumber(r[1]); id_cache[p.book_hash] = id end
        end
        if id then
            insert_page:reset():bind(id, p.page, p.start_time, p.duration, p.total_pages):step()
            touched[id] = true
        end
    end
    find_id:close()
    insert_page:close()
    -- Mirror the Readest app's recomputeBookTotals so a KOReader device shows
    -- fresh totals right after a pull (id is a trusted integer from the DB).
    for id in pairs(touched) do
        conn:exec(string.format([[
            UPDATE book SET
                total_read_time  = COALESCE((SELECT SUM(duration) FROM page_stat_data WHERE id_book = %d), 0),
                total_read_pages = COALESCE((SELECT COUNT(DISTINCT page) FROM page_stat_data WHERE id_book = %d), 0),
                last_open        = COALESCE((SELECT MAX(start_time + duration) FROM page_stat_data WHERE id_book = %d), last_open)
            WHERE id = %d;]], id, id, id, id))
    end
    conn:exec("COMMIT;")
    conn:close()
end

function SyncStats:push(settings, client, interactive)
    local cursor = settings:readSetting("stats_push_cursor") or 0
    local books, pages = self:collectSince(cursor)
    if #pages == 0 then return end
    local max_start = cursor
    for _, p in ipairs(pages) do if p.start_time > max_start then max_start = p.start_time end end
    client:pushChanges(
        { statBooks = books, statPages = pages },
        function(success)
            if success then
                settings:saveSetting("stats_push_cursor", max_start)
            elseif interactive then
                UIManager:show(InfoMessage:new{ text = _("Failed to push reading statistics"), timeout = 2 })
            end
        end)
end

function SyncStats:pull(settings, client, interactive, logout_fn)
    local since = settings:readSetting("stats_pull_cursor") or 0
    -- pullChanges requires since/type/book/meta_hash params (readest-sync-api.json).
    client:pullChanges(
        { since = since, type = "stats", book = "", meta_hash = "" },
        function(success, response, status)
            if not success then
                if status == 401 or status == 403 then
                    if logout_fn then logout_fn() end
                end
                if interactive then
                    UIManager:show(InfoMessage:new{ text = _("Failed to pull reading statistics"), timeout = 2 })
                end
                return
            end
            self:applyRemote(response.statBooks, response.statPages)
            local newest = since
            for _, p in ipairs(response.statPages or {}) do
                local u = tonumber(p.updated_at_ms) or 0
                if u > newest then newest = u end
            end
            if newest > since then settings:saveSetting("stats_pull_cursor", newest) end
        end)
end

return SyncStats
