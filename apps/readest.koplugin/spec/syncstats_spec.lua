-- syncstats_spec.lua
-- Tests for readest_syncstats.lua: collectSince cursor filtering and
-- applyRemote upsert with max-duration conflict resolution.

local spec_helper = require("spec_helper")

-- Minimal KOReader stubs the module pulls at require-time.
package.preload["ui/widget/infomessage"] = function()
    return { new = function() return {} end }
end
package.preload["ui/uimanager"] = function()
    return { show = function() end }
end
package.preload["readest_i18n"] = function()
    return function(s) return s end
end

local SQ3 = require("lua-ljsqlite3/init")
local DataStorage = require("datastorage")

local function statsDbPath()
    return DataStorage:getSettingsDir() .. "/statistics.sqlite3"
end

local function seedDb()
    local conn = SQ3.open(statsDbPath())
    conn:exec([[
        CREATE TABLE IF NOT EXISTS book (
            id integer PRIMARY KEY autoincrement, title text, authors text, notes integer,
            last_open integer, highlights integer, pages integer, series text, language text,
            md5 text, total_read_time integer, total_read_pages integer);
        CREATE UNIQUE INDEX IF NOT EXISTS book_title_authors_md5 ON book(title, authors, md5);
        CREATE TABLE IF NOT EXISTS page_stat_data (
            id_book integer, page integer NOT NULL DEFAULT 0,
            start_time integer NOT NULL DEFAULT 0,
            duration integer NOT NULL DEFAULT 0,
            total_pages integer NOT NULL DEFAULT 0,
            UNIQUE (id_book, page, start_time));
    ]])
    conn:close()
end

describe("readest_syncstats", function()
    local SyncStats

    before_each(function()
        spec_helper.reset()
        os.remove(statsDbPath())
        seedDb()
        package.loaded["readest_syncstats"] = nil
        SyncStats = require("readest_syncstats")
    end)

    it("collects only events past the cursor, joined with md5", function()
        local conn = SQ3.open(statsDbPath())
        conn:exec("INSERT INTO book (title, authors, md5) VALUES ('T', 'A', 'md5-1');")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 1, 100, 5, 9);")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 2, 200, 6, 9);")
        conn:close()

        local books, pages = SyncStats:collectSince(150)
        assert.are.equal(1, #pages)
        assert.are.equal(200, pages[1].start_time)
        assert.are.equal("md5-1", pages[1].book_hash)
        assert.are.equal(1, #books)
        assert.are.equal("md5-1", books[1].book_hash)
    end)

    it("returns all events when cursor is 0", function()
        local conn = SQ3.open(statsDbPath())
        conn:exec("INSERT INTO book (title, authors, md5) VALUES ('B', 'C', 'md5-3');")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 1, 10, 3, 5);")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 2, 20, 4, 5);")
        conn:close()

        local books, pages = SyncStats:collectSince(0)
        assert.are.equal(2, #pages)
        assert.are.equal(1, #books)
    end)

    it("returns empty tables when no events are past the cursor", function()
        local conn = SQ3.open(statsDbPath())
        conn:exec("INSERT INTO book (title, authors, md5) VALUES ('T', 'A', 'md5-1');")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 1, 100, 5, 9);")
        conn:close()

        local books, pages = SyncStats:collectSince(100)
        assert.are.equal(0, #pages)
        assert.are.equal(0, #books)
    end)

    it("keeps the longer duration when applying remote events", function()
        SyncStats:applyRemote(
            { { book_hash = "md5-2", title = "T2", authors = "A2" } },
            {
                { book_hash = "md5-2", page = 1, start_time = 300, duration = 8, total_pages = 20 },
                { book_hash = "md5-2", page = 1, start_time = 300, duration = 20, total_pages = 20 },
            })

        local conn = SQ3.open(statsDbPath())
        local count = conn:rowexec("SELECT COUNT(*) FROM page_stat_data;")
        local dur = conn:rowexec("SELECT duration FROM page_stat_data WHERE start_time = 300;")
        conn:close()
        assert.are.equal(1, tonumber(count))
        assert.are.equal(20, tonumber(dur))
    end)

    it("inserts a new book row when applying remote data for an unknown md5", function()
        SyncStats:applyRemote(
            { { book_hash = "new-md5", title = "New Book", authors = "Auth" } },
            { { book_hash = "new-md5", page = 5, start_time = 500, duration = 10, total_pages = 100 } })

        local conn = SQ3.open(statsDbPath())
        local count = conn:rowexec("SELECT COUNT(*) FROM book WHERE md5 = 'new-md5';")
        local pcount = conn:rowexec("SELECT COUNT(*) FROM page_stat_data;")
        conn:close()
        assert.are.equal(1, tonumber(count))
        assert.are.equal(1, tonumber(pcount))
    end)

    it("skips page rows whose book md5 has no matching book", function()
        SyncStats:applyRemote(
            {},
            { { book_hash = "ghost-md5", page = 1, start_time = 999, duration = 5, total_pages = 10 } })

        local conn = SQ3.open(statsDbPath())
        local pcount = conn:rowexec("SELECT COUNT(*) FROM page_stat_data;")
        conn:close()
        assert.are.equal(0, tonumber(pcount))
    end)

    it("recomputes book totals after applying remote events", function()
        SyncStats:applyRemote(
            { { book_hash = "md5-tot", title = "Tot", authors = "A" } },
            {
                { book_hash = "md5-tot", page = 1, start_time = 100, duration = 8, total_pages = 50 },
                { book_hash = "md5-tot", page = 2, start_time = 200, duration = 12, total_pages = 50 },
            })

        local conn = SQ3.open(statsDbPath())
        local total_time = conn:rowexec("SELECT total_read_time FROM book WHERE md5 = 'md5-tot';")
        local total_pages = conn:rowexec("SELECT total_read_pages FROM book WHERE md5 = 'md5-tot';")
        local last_open = conn:rowexec("SELECT last_open FROM book WHERE md5 = 'md5-tot';")
        conn:close()
        assert.are.equal(20, tonumber(total_time)) -- 8 + 12
        assert.are.equal(2, tonumber(total_pages)) -- distinct pages 1,2
        assert.are.equal(212, tonumber(last_open)) -- max(start_time + duration) = 200 + 12
    end)

    -- settings here is the plain readest_sync data table (as returned by
    -- G_reader_settings:readSetting("readest_sync", ...)), NOT a LuaSettings
    -- object — push/pull must read/persist the cursor as a field, not via
    -- settings:readSetting/saveSetting (which would crash on the plain table).
    -- The shared /sync POST (pushChanges) declares books/notes/configs as
    -- required_params in readest-sync-api.json, so Spore rejects the request
    -- before sending if any is absent. This mock mirrors that rejection so the
    -- stats push must include them (empty) alongside statBooks/statPages.
    local PUSH_REQUIRED = { "books", "notes", "configs" }
    local function makePushClient(captured)
        return {
            pushChanges = function(_, payload, cb)
                captured.payload = payload
                for _, k in ipairs(PUSH_REQUIRED) do
                    if payload[k] == nil then
                        captured.missing = k
                        return cb(false) -- Spore would reject; request never sent
                    end
                end
                cb(true)
            end,
        }
    end

    it("advances stats_push_cursor as a plain field after a successful push", function()
        local conn = SQ3.open(statsDbPath())
        conn:exec("INSERT INTO book (title, authors, md5) VALUES ('T', 'A', 'md5-p');")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 1, 100, 5, 9);")
        conn:exec("INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (1, 2, 250, 6, 9);")
        conn:close()

        local settings = { stats_push_cursor = 0 }
        local captured = {}

        SyncStats:push(settings, makePushClient(captured), false)

        assert.is_nil(captured.missing) -- satisfied the pushChanges required_params
        assert.are.equal(2, #captured.payload.statPages)
        assert.are.equal(250, settings.stats_push_cursor) -- max start_time; only set on success
    end)

    -- Spore's validate() (common/Spore/Request.lua) asserts every param passed
    -- to a method is in required_params ∪ optional_params ("X is not expected"),
    -- and that every required_param is present. Declaring a key only under
    -- `payload` controls body serialization, NOT acceptance. So the readest-sync
    -- spec must list statBooks/statPages as optional_params for the stats push.
    it("declares the stats push payload keys as expected pushChanges params", function()
        local json = require("json")
        local f = assert(io.open("readest-sync-api.json", "r"))
        local spec = json.decode(f:read("*a"))
        f:close()

        local method = spec.methods.pushChanges
        local expected = {}
        for _, k in ipairs(method.required_params or {}) do expected[k] = true end
        for _, k in ipairs(method.optional_params or {}) do expected[k] = true end

        -- the exact set of keys SyncStats:push sends
        for _, k in ipairs({ "books", "notes", "configs", "statBooks", "statPages" }) do
            assert.is_true(expected[k] == true, k .. " must be an expected pushChanges param")
        end
    end)

    it("advances stats_pull_cursor as a plain field after a successful pull", function()
        local settings = { stats_pull_cursor = 0 }
        local response = {
            statBooks = { { book_hash = "md5-pull", title = "P", authors = "A" } },
            statPages = {
                { book_hash = "md5-pull", page = 1, start_time = 100, duration = 5,
                  total_pages = 10, updated_at_ms = 4242 },
            },
        }
        local client = { pullChanges = function(_, _params, cb) cb(true, response, 200) end }

        SyncStats:pull(settings, client, false, function() end)

        assert.are.equal(4242, settings.stats_pull_cursor) -- newest updated_at_ms
    end)
end)
