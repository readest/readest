local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local SQ3 = require("lua-ljsqlite3/init")
local logger = require("logger")
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

-- Fold duplicate book rows sharing one md5 into the row KOReader's native
-- statistics plugin actually reads. That plugin keys rows by (title,
-- authors, md5) — UNIQUE INDEX book_title_authors_md5 — so when its
-- extracted metadata drifts from Readest's, the first native open adds a
-- second, zeroed row and the synced reading time is stranded on the
-- sync-created one (#4861). Only rows the native plugin never adopted
-- (pages IS NULL; it always sets pages on the rows it creates or updates)
-- are folded, and an adopted row is never deleted: an open reader session
-- may hold its cached book id. live_book_id is the id the current session's
-- statistics module cached — a session that adopted a sync-created row keeps
-- pages NULL until its first close, so that row must not be folded either.
local function mergeDuplicateBooks(conn, touched, live_book_id)
    local dup_stmt = conn:prepare([[
        SELECT md5 FROM book WHERE md5 IS NOT NULL AND md5 != ''
        GROUP BY md5 HAVING COUNT(*) > 1;]])
    local dups = {}
    local row = dup_stmt:step()
    while row ~= nil do
        table.insert(dups, row[1])
        row = dup_stmt:step()
    end
    dup_stmt:close()
    if #dups == 0 then return end
    local survivor_stmt = conn:prepare([[
        SELECT id FROM book WHERE md5 = ?
        ORDER BY (pages IS NOT NULL) DESC, last_open DESC, id ASC LIMIT 1;]])
    local stranded_stmt = conn:prepare("SELECT id FROM book WHERE md5 = ? AND id != ? AND id != ? AND pages IS NULL;")
    local move_pages = conn:prepare([[
        INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages)
        SELECT ?, page, start_time, duration, total_pages
        FROM page_stat_data WHERE id_book = ?
        ON CONFLICT(id_book, page, start_time)
        DO UPDATE SET duration = max(duration, excluded.duration), total_pages = excluded.total_pages;]])
    local del_pages = conn:prepare("DELETE FROM page_stat_data WHERE id_book = ?;")
    local del_book = conn:prepare("DELETE FROM book WHERE id = ?;")
    for _, md5 in ipairs(dups) do
        local keep = tonumber(survivor_stmt:reset():bind(md5):step()[1])
        local stranded = {}
        stranded_stmt:reset():bind(md5, keep, tonumber(live_book_id) or -1)
        local r = stranded_stmt:step()
        while r ~= nil do
            table.insert(stranded, tonumber(r[1]))
            r = stranded_stmt:step()
        end
        for _, dead in ipairs(stranded) do
            move_pages:reset():bind(keep, dead):step()
            del_pages:reset():bind(dead):step()
            del_book:reset():bind(dead):step()
            touched[dead] = nil
            touched[keep] = true
            logger.dbg("ReadestStats applyRemote: folded duplicate book row "
                .. dead .. " into " .. keep .. " (md5=" .. md5 .. ")")
        end
    end
    survivor_stmt:close()
    stranded_stmt:close()
    move_pages:close()
    del_pages:close()
    del_book:close()
end

-- Upsert pulled rows into the local statistics.sqlite3 (union / longer-duration).
function SyncStats:applyRemote(books, pages, live_book_id)
    local conn = SQ3.open(db_path())
    conn:exec("BEGIN;")
    -- Insert a row only for an md5 this DB has never seen: if KOReader
    -- already tracks the book under its own (possibly drifted) metadata,
    -- adding one keyed on Readest's would duplicate it (#4861).
    local insert_book = conn:prepare([[
        INSERT INTO book (title, authors, md5)
        SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM book WHERE md5 = ?);]])
    for _, b in ipairs(books or {}) do
        insert_book:reset():bind(b.title or "", b.authors or "", b.book_hash, b.book_hash):step()
    end
    insert_book:close()
    -- Attach events to the row the native statistics plugin reads: it always
    -- sets pages and last_open on its rows; sync-created rows leave them NULL.
    local find_id = conn:prepare([[
        SELECT id FROM book WHERE md5 = ?
        ORDER BY (pages IS NOT NULL) DESC, last_open DESC, id ASC LIMIT 1;]])
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
    mergeDuplicateBooks(conn, touched, live_book_id)
    -- Mirror the Readest app's recomputeBookTotals so a KOReader device shows
    -- fresh totals right after a pull (id is a trusted integer from the DB).
    -- last_open never regresses: on native rows it is a real open timestamp
    -- that can be newer than the last synced reading event.
    for id in pairs(touched) do
        conn:exec(string.format([[
            UPDATE book SET
                total_read_time  = COALESCE((SELECT SUM(duration) FROM page_stat_data WHERE id_book = %d), 0),
                total_read_pages = COALESCE((SELECT COUNT(DISTINCT page) FROM page_stat_data WHERE id_book = %d), 0),
                last_open        = MAX(COALESCE(last_open, 0),
                                       COALESCE((SELECT MAX(start_time + duration) FROM page_stat_data WHERE id_book = %d), 0))
            WHERE id = %d;]], id, id, id, id))
    end
    conn:exec("COMMIT;")
    conn:close()
end

function SyncStats:push(settings, client, interactive)
    -- `settings` is the plain readest_sync data table (see main.lua:init), so
    -- the cursor is a field; persist by saving the whole table back to
    -- G_reader_settings, mirroring readest_syncauth.
    local cursor = settings.stats_push_cursor or 0
    local books, pages = self:collectSince(cursor)
    logger.dbg("ReadestStats push: cursor=" .. tostring(cursor)
        .. " collected books=" .. #books .. " pages=" .. #pages
        .. " interactive=" .. tostring(interactive))
    if #pages == 0 then
        logger.dbg("ReadestStats push: nothing to push (no page events past cursor)")
        if interactive then
            UIManager:show(InfoMessage:new{ text = _("Reading statistics are up to date"), timeout = 2 })
        end
        return
    end
    local max_start = cursor
    for _, p in ipairs(pages) do if p.start_time > max_start then max_start = p.start_time end end
    logger.dbg("ReadestStats push: dispatching " .. #pages .. " page(s); new cursor would be "
        .. tostring(max_start))
    -- pushChanges declares books/notes/configs as required_params (shared /sync
    -- POST contract, readest-sync-api.json); include them empty so Spore sends
    -- the request — the server defaults each to [] and processes statBooks/
    -- statPages independently (apps/readest-app/src/pages/api/sync.ts).
    client:pushChanges(
        { books = {}, notes = {}, configs = {}, statBooks = books, statPages = pages },
        function(success, body, status)
            logger.dbg("ReadestStats push: response success=" .. tostring(success)
                .. " status=" .. tostring(status))
            if success then
                settings.stats_push_cursor = max_start
                G_reader_settings:saveSetting("readest_sync", settings)
                logger.dbg("ReadestStats push: cursor advanced to " .. tostring(max_start))
                if interactive then
                    UIManager:show(InfoMessage:new{ text = _("Reading statistics pushed"), timeout = 2 })
                end
            else
                logger.dbg("ReadestStats push: failed, cursor unchanged; body=" .. tostring(body))
                if interactive then
                    UIManager:show(InfoMessage:new{ text = _("Failed to push reading statistics"), timeout = 2 })
                end
            end
        end)
end

function SyncStats:pull(settings, client, interactive, logout_fn, ui)
    local since = settings.stats_pull_cursor or 0
    logger.dbg("ReadestStats pull: since=" .. tostring(since)
        .. " interactive=" .. tostring(interactive))
    -- pullChanges requires since/type/book/meta_hash params (readest-sync-api.json).
    client:pullChanges(
        { since = since, type = "stats", book = "", meta_hash = "" },
        function(success, response, status)
            logger.dbg("ReadestStats pull: response success=" .. tostring(success)
                .. " status=" .. tostring(status))
            if not success then
                if status == 401 or status == 403 then
                    if logout_fn then logout_fn() end
                end
                if interactive then
                    UIManager:show(InfoMessage:new{ text = _("Failed to pull reading statistics"), timeout = 2 })
                end
                return
            end
            local nbooks = response and response.statBooks and #response.statBooks or 0
            local npages = response and response.statPages and #response.statPages or 0
            logger.dbg("ReadestStats pull: applying statBooks=" .. nbooks .. " statPages=" .. npages)
            -- Resolved inside the callback so it reflects the session state
            -- at apply time, after the async network round-trip.
            local live_book_id = ui and ui.statistics and ui.statistics.id_curr_book or nil
            self:applyRemote(response.statBooks, response.statPages, live_book_id)
            local newest = since
            for _, p in ipairs(response.statPages or {}) do
                local u = tonumber(p.updated_at_ms) or 0
                if u > newest then newest = u end
            end
            if newest > since then
                settings.stats_pull_cursor = newest
                G_reader_settings:saveSetting("readest_sync", settings)
                logger.dbg("ReadestStats pull: cursor advanced to " .. tostring(newest))
            else
                logger.dbg("ReadestStats pull: cursor unchanged (no newer rows)")
            end
            if interactive then
                local text = npages > 0 and _("Reading statistics pulled")
                    or _("Reading statistics are up to date")
                UIManager:show(InfoMessage:new{ text = text, timeout = 2 })
            end
        end)
end

return SyncStats
