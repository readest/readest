-- librarystore_spec.lua
-- Defines the contract for library/librarystore.lua. Written before the
-- implementation so the spec is the source of truth for "how the store
-- should behave".

local helper = require("spec_helper")

-- Convenient time stamps for sorting tests (unix ms)
local T_OLD    = 1700000000000  -- 2023-11-14
local T_MID    = 1750000000000  -- 2025-06-15
local T_RECENT = 1770000000000  -- 2026-02-01

-- Minimal book row factory; tests override fields they care about.
local function book(over)
    local row = {
        hash             = "h" .. tostring(math.random(2 ^ 31)),
        meta_hash        = nil,
        title            = "Untitled",
        source_title     = nil,
        author           = "Anon",
        format           = "EPUB",
        metadata_json    = nil,
        series           = nil,
        series_index     = nil,
        group_id         = nil,
        group_name       = nil,
        cover_path       = nil,
        file_path        = nil,
        cloud_present    = 0,
        local_present    = 0,
        uploaded_at      = nil,
        progress_lib     = nil,
        reading_status   = nil,
        last_read_at     = nil,
        created_at       = T_OLD,
        updated_at       = T_OLD,
        deleted_at       = nil,
    }
    if over then for k, v in pairs(over) do row[k] = v end end
    return row
end

describe("LibraryStore", function()
    local LibraryStore

    before_each(function()
        helper.reset()
        package.loaded["library.librarystore"] = nil
        LibraryStore = require("library.librarystore")
    end)

    -- =====================================================================
    -- Schema construction
    -- =====================================================================
    describe("schema", function()
        it("opens an in-memory DB and creates the books + sync_state tables", function()
            local store = LibraryStore.new({ user_id = "alice" })
            assert.is_not_nil(store)
            assert.are.equal(0, #store:listBooks({}))
            store:close()
        end)

        it("survives being constructed twice (CREATE IF NOT EXISTS)", function()
            local s1 = LibraryStore.new({ user_id = "alice" })
            s1:upsertBook(book({ hash = "h1", title = "A", cloud_present = 1 }))
            s1:close()
            -- Re-open the same on-disk file: state survives.
            local DataStorage = require("datastorage")
            local path = DataStorage:getSettingsDir() .. "/test.sqlite3"
            local s2 = LibraryStore.new({ user_id = "alice", db_path = path })
            s2:upsertBook(book({ hash = "h2", title = "B", cloud_present = 1 }))
            s2:close()
            local s3 = LibraryStore.new({ user_id = "alice", db_path = path })
            assert.are.equal(1, #s3:listBooks({}))  -- only h2; h1 was in-memory
            s3:close()
        end)

        it("sets PRAGMA user_version = 1", function()
            local store = LibraryStore.new({ user_id = "alice" })
            assert.are.equal(1, store:getUserVersion())
            store:close()
        end)
    end)

    -- =====================================================================
    -- upsertBook
    -- =====================================================================
    describe("upsertBook", function()
        local store
        before_each(function() store = LibraryStore.new({ user_id = "alice" }) end)
        after_each(function() store:close() end)

        it("inserts a new row", function()
            store:upsertBook(book({ hash = "h1", title = "Foundation", cloud_present = 1 }))
            local rows = store:listBooks({})
            assert.are.equal(1, #rows)
            assert.are.equal("Foundation", rows[1].title)
            assert.are.equal("h1", rows[1].hash)
        end)

        it("updates an existing row by hash", function()
            store:upsertBook(book({ hash = "h1", title = "Foundation", cloud_present = 1 }))
            store:upsertBook(book({ hash = "h1", title = "Foundation (Revised)", cloud_present = 1 }))
            local rows = store:listBooks({})
            assert.are.equal(1, #rows)
            assert.are.equal("Foundation (Revised)", rows[1].title)
        end)

        it("OR-merges cloud_present and local_present flags", function()
            store:upsertBook(book({ hash = "h1", title = "X", cloud_present = 1, local_present = 0 }))
            -- Local scanner discovers the file and upserts with local_present=1.
            -- It doesn't know about cloud state, so it omits cloud_present (or sends 0).
            store:upsertBook(book({ hash = "h1", title = "X", local_present = 1 }))
            local rows = store:listBooks({})
            assert.are.equal(1, rows[1].cloud_present)
            assert.are.equal(1, rows[1].local_present)
        end)

        it("explicit cloud_present=0 from a deleted_at sync update DOES set it to 0", function()
            store:upsertBook(book({ hash = "h1", title = "X", cloud_present = 1, local_present = 1 }))
            -- Tombstone update from sync: explicit cloud_present=0 + deleted_at set
            store:upsertBook(book({
                hash = "h1", title = "X",
                cloud_present = 0, local_present = 1,
                deleted_at = T_RECENT,
                _force_cloud_present = true,  -- explicit override sentinel
            }))
            local row = store:_getRowRaw("h1")
            assert.are.equal(0, row.cloud_present)
            assert.are.equal(T_RECENT, row.deleted_at)
        end)

        it("_clear_fields explicitly nulls listed columns even when existing has them set", function()
            -- Tombstoned existing row
            store:upsertBook(book({
                hash = "h1", title = "X",
                cloud_present = 0, local_present = 0,
                deleted_at = T_OLD,
                _force_cloud_present = true,
            }))
            assert.are.equal(T_OLD, store:_getRowRaw("h1").deleted_at)
            -- Re-add with _clear_fields → deleted_at goes to NULL
            store:upsertBook({
                hash          = "h1",
                title         = "X",
                local_present = 1,
                updated_at    = T_RECENT,
                _clear_fields = { "deleted_at" },
            })
            local row = store:_getRowRaw("h1")
            assert.is_nil(row.deleted_at)
            assert.are.equal(1, row.local_present)
            assert.are.equal(T_RECENT, row.updated_at)
        end)
    end)

    -- =====================================================================
    -- touchBook: bumps updated_at + last_read_at to "now", merges other
    -- fields. Used after the user closes a book in the reader so the
    -- next /sync push carries the up-to-date timestamps + progress.
    -- =====================================================================
    describe("touchBook", function()
        local store
        before_each(function() store = LibraryStore.new({ user_id = "alice" }) end)
        after_each(function() store:close() end)

        it("returns nil for an unknown hash (no insert)", function()
            local out = store:touchBook("nope")
            assert.is_nil(out)
            assert.are.equal(0, #store:listBooks({}))
        end)

        it("updates updated_at + last_read_at to current time", function()
            store:upsertBook(book({
                hash = "h1", title = "X",
                cloud_present = 1,
                updated_at = T_OLD, last_read_at = T_OLD,
            }))
            local before = os.time() * 1000
            local touched = store:touchBook("h1")
            local after = os.time() * 1000

            assert.is_not_nil(touched)
            assert.is_true(touched.updated_at >= before, "updated_at not bumped: " .. tostring(touched.updated_at))
            assert.is_true(touched.updated_at <= after,  "updated_at exceeds now")
            assert.is_true(touched.last_read_at >= before)
        end)

        it("merges extra fields (e.g. progress_lib) into the row", function()
            store:upsertBook(book({
                hash = "h1", title = "X", cloud_present = 1,
            }))
            local touched = store:touchBook("h1", { progress_lib = "[42,250]" })
            assert.are.equal("[42,250]", touched.progress_lib)
        end)

        it("preserves cloud_present + local_present (no flag downgrade)", function()
            store:upsertBook(book({
                hash = "h1", title = "X",
                cloud_present = 1, local_present = 1,
            }))
            local touched = store:touchBook("h1")
            assert.are.equal(1, touched.cloud_present)
            assert.are.equal(1, touched.local_present)
        end)
    end)

    -- =====================================================================
    -- getChangedBooks: returns rows with updated_at > since OR deleted_at
    -- > since. Mirrors useBooksSync.getNewBooks at
    -- apps/readest-app/src/app/library/hooks/useBooksSync.ts:22-35.
    -- =====================================================================
    describe("getChangedBooks", function()
        local store
        before_each(function()
            store = LibraryStore.new({ user_id = "alice" })
            store:upsertBook(book({ hash = "old", title = "Old", cloud_present = 1, updated_at = T_OLD }))
            store:upsertBook(book({ hash = "mid", title = "Mid", cloud_present = 1, updated_at = T_MID }))
            store:upsertBook(book({ hash = "new", title = "New", cloud_present = 1, updated_at = T_RECENT }))
        end)
        after_each(function() store:close() end)

        it("returns ALL books when since=0 (initial sync)", function()
            local out = store:getChangedBooks(0)
            assert.are.equal(3, #out)
        end)

        it("returns only books changed since the watermark", function()
            local out = store:getChangedBooks(T_MID)
            assert.are.equal(1, #out)
            assert.are.equal("New", out[1].title)
        end)

        it("returns empty when nothing has changed since the watermark", function()
            local out = store:getChangedBooks(T_RECENT + 1)
            assert.are.equal(0, #out)
        end)

        it("includes rows where deleted_at > since (tombstone push)", function()
            -- Mark "old" as deleted at T_RECENT — its updated_at is T_OLD
            -- (< since=T_MID), but deleted_at (T_RECENT > T_MID) means
            -- this push needs to carry the tombstone to the server.
            store:upsertBook(book({
                hash = "old", title = "Old",
                cloud_present = 0, _force_cloud_present = true,
                deleted_at = T_RECENT,
            }))
            local out = store:getChangedBooks(T_MID)
            local hashes = {}
            for _, r in ipairs(out) do hashes[r.hash] = true end
            assert.is_true(hashes["old"], "deleted row missing from changed set")
            assert.is_true(hashes["new"], "recent row missing")
        end)

        it("scopes by user_id", function()
            local DataStorage = require("datastorage")
            local path = DataStorage:getSettingsDir() .. "/changed_multi.sqlite3"
            local alice = LibraryStore.new({ user_id = "alice", db_path = path })
            alice:upsertBook(book({ hash = "a1", title = "A", cloud_present = 1, updated_at = T_RECENT }))
            local bob = LibraryStore.new({ user_id = "bob", db_path = path })
            bob:upsertBook(book({ hash = "b1", title = "B", cloud_present = 1, updated_at = T_RECENT }))
            assert.are.equal(1, #alice:getChangedBooks(0))
            assert.are.equal(1, #bob:getChangedBooks(0))
            alice:close(); bob:close()
        end)
    end)

    -- =====================================================================
    -- listBooks: filters, sort, hides ghosts and tombstones
    -- =====================================================================
    describe("listBooks", function()
        local store
        before_each(function()
            store = LibraryStore.new({ user_id = "alice" })
            store:upsertBook(book({
                hash = "h1", title = "Foundation", author = "Asimov",
                cloud_present = 1, updated_at = T_OLD, last_read_at = T_OLD,
            }))
            store:upsertBook(book({
                hash = "h2", title = "Dune", author = "Herbert",
                cloud_present = 1, local_present = 1,
                updated_at = T_RECENT, last_read_at = T_RECENT,
            }))
            store:upsertBook(book({
                hash = "h3", title = "Hyperion", author = "Simmons",
                local_present = 1, updated_at = T_MID, last_read_at = T_MID,
            }))
        end)
        after_each(function() store:close() end)

        it("returns all visible books by default sorted by updated_at desc", function()
            local rows = store:listBooks({})
            assert.are.equal(3, #rows)
            assert.are.equal("Dune", rows[1].title)       -- T_RECENT
            assert.are.equal("Hyperion", rows[2].title)   -- T_MID
            assert.are.equal("Foundation", rows[3].title) -- T_OLD
        end)

        it("hides rows with deleted_at != null even when local_present=1", function()
            -- Cloud delete arrives; local file still on disk
            store:upsertBook(book({
                hash = "h2", title = "Dune", author = "Herbert",
                cloud_present = 0, local_present = 1,
                deleted_at = T_RECENT,
                _force_cloud_present = true,
            }))
            local rows = store:listBooks({})
            assert.are.equal(2, #rows)
            for _, r in ipairs(rows) do assert.is_not.equal("Dune", r.title) end
        end)

        it("hides rows where neither flag is set (ghost rows)", function()
            -- Manually craft a ghost via direct upsert without flags
            store:upsertBook(book({ hash = "h-ghost", title = "Ghost" }))
            local rows = store:listBooks({})
            assert.are.equal(3, #rows)
            for _, r in ipairs(rows) do assert.is_not.equal("Ghost", r.title) end
        end)

        it("filters by case-insensitive substring search across title and author", function()
            local r1 = store:listBooks({ search = "asimov" })
            assert.are.equal(1, #r1)
            assert.are.equal("Foundation", r1[1].title)

            local r2 = store:listBooks({ search = "DUNE" })
            assert.are.equal(1, #r2)
            assert.are.equal("Dune", r2[1].title)

            local r3 = store:listBooks({ search = "z-no-match" })
            assert.are.equal(0, #r3)
        end)

        it("sorts by last_read_at desc", function()
            local rows = store:listBooks({ sort_by = "last_read_at", sort_asc = false })
            assert.are.equal("Dune", rows[1].title)
        end)

        it("'last_read_at' sort uses COALESCE(updated_at, last_read_at) — bumped updated_at floats the row", function()
            -- Foundation has the OLDEST last_read_at + updated_at in
            -- the fixture, so it sorts last under the default. Now
            -- simulate "Add to Readest" dedupe bumping ONLY its
            -- updated_at: the row should jump to the top because
            -- COALESCE(T_FUTURE, …) = T_FUTURE > all others.
            local T_FUTURE = T_RECENT + 60000  -- one minute after the freshest row
            store:upsertBook({
                hash = "h1", title = "Foundation",
                updated_at = T_FUTURE,
            })
            local rows = store:listBooks({ sort_by = "last_read_at", sort_asc = false })
            assert.are.equal("Foundation", rows[1].title)
        end)

        it("'last_read_at' sort still falls back to updated_at when last_read_at is NULL", function()
            -- Cloud-only book: last_read_at NULL, updated_at = the freshest.
            store:upsertBook(book({
                hash = "h-cloud", title = "Anathem", author = "Stephenson",
                cloud_present = 1, last_read_at = nil,
                updated_at = T_RECENT + 1000,
            }))
            local rows = store:listBooks({ sort_by = "last_read_at", sort_asc = false })
            assert.are.equal("Anathem", rows[1].title)
        end)

        it("sorts by title ascending", function()
            local rows = store:listBooks({ sort_by = "title", sort_asc = true })
            assert.are.equal("Dune", rows[1].title)
            assert.are.equal("Foundation", rows[2].title)
            assert.are.equal("Hyperion", rows[3].title)
        end)

        it("sorts by author descending", function()
            local rows = store:listBooks({ sort_by = "author", sort_asc = false })
            assert.are.equal("Simmons", rows[1].author)
            assert.are.equal("Herbert", rows[2].author)
            assert.are.equal("Asimov", rows[3].author)
        end)

        it("filters by group when group_by + group_filter are set", function()
            local rows = store:listBooks({ group_by = "author", group_filter = "Asimov" })
            assert.are.equal(1, #rows)
            assert.are.equal("Foundation", rows[1].title)
        end)
    end)

    -- =====================================================================
    -- getGroups
    -- =====================================================================
    describe("getGroups", function()
        local store
        before_each(function()
            store = LibraryStore.new({ user_id = "alice" })
            store:upsertBook(book({ hash = "a1", title = "F1", author = "Asimov", cloud_present = 1, updated_at = T_OLD }))
            store:upsertBook(book({ hash = "a2", title = "F2", author = "Asimov", cloud_present = 1, updated_at = T_MID }))
            store:upsertBook(book({ hash = "h1", title = "D",  author = "Herbert", cloud_present = 1, updated_at = T_RECENT }))
            store:upsertBook(book({ hash = "g1", title = "G1", author = "Anon",   cloud_present = 1, group_name = "Sci-Fi", updated_at = T_OLD }))
            store:upsertBook(book({ hash = "g2", title = "G2", author = "Anon",   cloud_present = 1, group_name = "Sci-Fi", updated_at = T_MID }))
        end)
        after_each(function() store:close() end)

        it("group by author returns {name, count, latest_updated_at}", function()
            local groups = store:getGroups("author")
            local by_name = {}
            for _, g in ipairs(groups) do by_name[g.name] = g end
            assert.are.equal(2, by_name["Asimov"].count)
            assert.are.equal(T_MID, by_name["Asimov"].latest_updated_at)
            assert.are.equal(1, by_name["Herbert"].count)
            assert.are.equal(2, by_name["Anon"].count)
        end)

        it("group by group_name skips rows with null group_name", function()
            local groups = store:getGroups("group_name")
            assert.are.equal(1, #groups)
            assert.are.equal("Sci-Fi", groups[1].name)
            assert.are.equal(2, groups[1].count)
        end)

        it("memoizes results across calls", function()
            local g1 = store:getGroups("author")
            local g2 = store:getGroups("author")
            -- Same Lua table reference (cache hit, not just equal contents)
            assert.are.equal(g1, g2)
        end)

        it("invalidates cache after upsertBook", function()
            local g1 = store:getGroups("author")
            store:upsertBook(book({ hash = "h2", title = "D2", author = "Herbert", cloud_present = 1 }))
            local g2 = store:getGroups("author")
            assert.is_not.equal(g1, g2)
            local by_name = {}
            for _, g in ipairs(g2) do by_name[g.name] = g end
            assert.are.equal(2, by_name["Herbert"].count)
        end)
    end)

    -- =====================================================================
    -- listBookshelfGroups: nested folders for group_name, flat for others
    -- =====================================================================
    describe("listBookshelfGroups", function()
        local store
        before_each(function()
            store = LibraryStore.new({ user_id = "alice" })
            -- Top-level folders Fantasy + SciFi, plus a nested Fantasy/Tolkien
            -- and Fantasy/Tolkien/LOTR. One book at root (no group_name).
            store:upsertBook(book({ hash = "f1", title = "Conan", group_name = "Fantasy",                cloud_present = 1, updated_at = T_OLD }))
            store:upsertBook(book({ hash = "t1", title = "Hobbit", group_name = "Fantasy/Tolkien",       cloud_present = 1, updated_at = T_MID }))
            store:upsertBook(book({ hash = "t2", title = "Silmarillion", group_name = "Fantasy/Tolkien", cloud_present = 1, updated_at = T_RECENT }))
            store:upsertBook(book({ hash = "l1", title = "FotR", group_name = "Fantasy/Tolkien/LOTR",    cloud_present = 1, updated_at = T_RECENT }))
            store:upsertBook(book({ hash = "s1", title = "Dune", group_name = "SciFi",                   cloud_present = 1, updated_at = T_OLD }))
            store:upsertBook(book({ hash = "u1", title = "Loose", cloud_present = 1, updated_at = T_OLD }))
        end)
        after_each(function() store:close() end)

        it("at root: returns top-level segments with aggregate counts and per-sort latest_*", function()
            local groups = store:listBookshelfGroups("group_name", nil)
            assert.are.equal(2, #groups)  -- Fantasy + SciFi (Loose has no group)
            local by_name = {}
            for _, g in ipairs(groups) do by_name[g.display_name] = g end
            -- Fantasy aggregates Fantasy + Fantasy/Tolkien*2 + Fantasy/Tolkien/LOTR
            assert.are.equal(4, by_name["Fantasy"].count)
            assert.are.equal("Fantasy", by_name["Fantasy"].name)
            assert.are.equal(1, by_name["SciFi"].count)
            -- Per-sort aggregates: Fantasy's max updated = T_RECENT (from
            -- the Tolkien/Silmarillion + LOTR rows). SciFi only has Dune
            -- with T_OLD. Created defaults to T_OLD via the test factory.
            assert.are.equal(T_RECENT, by_name["Fantasy"].latest_updated_at)
            assert.are.equal(T_RECENT, by_name["Fantasy"].latest_last_read_at)
            assert.are.equal(T_OLD,    by_name["Fantasy"].latest_created_at)
            assert.are.equal(T_OLD,    by_name["SciFi"].latest_updated_at)
        end)

        it("drilled in: returns immediate children (not descendants)", function()
            local groups = store:listBookshelfGroups("group_name", "Fantasy")
            assert.are.equal(1, #groups)  -- only "Tolkien" is a folder; Fantasy itself is a direct-child book
            assert.are.equal("Tolkien", groups[1].display_name)
            assert.are.equal("Fantasy/Tolkien", groups[1].name)
            -- Tolkien aggregate = Tolkien*2 + Tolkien/LOTR
            assert.are.equal(3, groups[1].count)
        end)

        it("two levels deep: returns LOTR sub-folder only", function()
            local groups = store:listBookshelfGroups("group_name", "Fantasy/Tolkien")
            assert.are.equal(1, #groups)
            assert.are.equal("LOTR", groups[1].display_name)
            assert.are.equal("Fantasy/Tolkien/LOTR", groups[1].name)
            assert.are.equal(1, groups[1].count)
        end)

        it("at leaf folder: returns no further sub-folders", function()
            local groups = store:listBookshelfGroups("group_name", "Fantasy/Tolkien/LOTR")
            assert.are.equal(0, #groups)
        end)

        -- BookshelfItem.tsx parity: a single-segment path like "Fantasy"
        -- is itself a folder; the book living at that path is a direct
        -- child of that folder, not a root-level book.
        it("creates a folder for a single-segment group_name", function()
            local s = LibraryStore.new({ user_id = "single" })
            s:upsertBook(book({ hash = "x1", title = "Conan", group_name = "Fantasy", cloud_present = 1 }))
            local root_groups = s:listBookshelfGroups("group_name", nil)
            assert.are.equal(1, #root_groups)
            assert.are.equal("Fantasy", root_groups[1].name)
            assert.are.equal(1, root_groups[1].count)
            -- And the book itself isn't visible at root, only inside Fantasy
            assert.are.equal(0, #s:listBookshelfBooks({}, "group_name", nil))
            assert.are.equal(1, #s:listBookshelfBooks({}, "group_name", "Fantasy"))
            s:close()
        end)

        -- BookshelfItem.tsx:43-44 — slashIndex > 0, so a leading slash
        -- doesn't split. "/foo" stays as one segment named "/foo".
        it("leading-slash group_name keeps the slash as part of the segment", function()
            local s = LibraryStore.new({ user_id = "ls" })
            s:upsertBook(book({ hash = "x1", title = "X", group_name = "/foo", cloud_present = 1 }))
            local groups = s:listBookshelfGroups("group_name", nil)
            assert.are.equal(1, #groups)
            assert.are.equal("/foo", groups[1].name)
            assert.are.equal("/foo", groups[1].display_name)
            s:close()
        end)

        it("author/series: parent_path ignored at root, returns flat groups", function()
            store:upsertBook(book({ hash = "a1", title = "F", author = "Asimov", cloud_present = 1 }))
            store:upsertBook(book({ hash = "h1", title = "D", author = "Herbert", cloud_present = 1 }))
            local groups = store:listBookshelfGroups("author", nil)
            local names = {}
            for _, g in ipairs(groups) do names[g.display_name] = true end
            assert.is_true(names["Asimov"])
            assert.is_true(names["Herbert"])
        end)

        it("author/series: returns empty when called with non-nil parent_path", function()
            store:upsertBook(book({ hash = "a1", title = "F", author = "Asimov", cloud_present = 1 }))
            local groups = store:listBookshelfGroups("author", "Asimov")
            assert.are.equal(0, #groups)
        end)
    end)

    -- =====================================================================
    -- listBookshelfBooks: ungrouped at root, exact match when drilled in
    -- =====================================================================
    describe("listBookshelfBooks", function()
        local store
        before_each(function()
            store = LibraryStore.new({ user_id = "alice" })
            store:upsertBook(book({ hash = "f1", title = "Conan",  group_name = "Fantasy",         cloud_present = 1 }))
            store:upsertBook(book({ hash = "t1", title = "Hobbit", group_name = "Fantasy/Tolkien", cloud_present = 1 }))
            store:upsertBook(book({ hash = "u1", title = "Loose",  author = "",                    cloud_present = 1 }))
            store:upsertBook(book({ hash = "a1", title = "F",      author = "Asimov",              cloud_present = 1 }))
            store:upsertBook(book({ hash = "n1", title = "NoAuth", author = "",                    cloud_present = 1 }))
        end)
        after_each(function() store:close() end)

        it("group_name root: returns books with null/empty group_name", function()
            local books = store:listBookshelfBooks({}, "group_name", nil)
            local titles = {}
            for _, b in ipairs(books) do titles[b.title] = true end
            -- Loose, F, NoAuth all lack group_name; Conan/Hobbit don't appear.
            assert.is_true(titles["Loose"])
            assert.is_true(titles["F"])
            assert.is_true(titles["NoAuth"])
            assert.is_nil(titles["Conan"])
            assert.is_nil(titles["Hobbit"])
        end)

        it("group_name drill-in: returns only direct-child books, not descendants", function()
            local books = store:listBookshelfBooks({}, "group_name", "Fantasy")
            assert.are.equal(1, #books)
            assert.are.equal("Conan", books[1].title)
            -- Hobbit is in Fantasy/Tolkien — listed by drilling further
        end)

        it("author root: returns books with no author", function()
            local books = store:listBookshelfBooks({}, "author", nil)
            local titles = {}
            for _, b in ipairs(books) do titles[b.title] = true end
            -- Only Loose and NoAuth have empty author; F has Asimov,
            -- Conan/Hobbit default to "Anon" via the factory.
            assert.is_nil(titles["F"])
            assert.is_true(titles["Loose"])
            assert.is_true(titles["NoAuth"])
        end)

        it("author drill-in: returns books matching the author", function()
            local books = store:listBookshelfBooks({}, "author", "Asimov")
            assert.are.equal(1, #books)
            assert.are.equal("F", books[1].title)
        end)

        it("group_by=nil: delegates to listBooks (no ungrouped filter)", function()
            local books = store:listBookshelfBooks({}, nil, nil)
            assert.are.equal(5, #books)
        end)
    end)

    -- =====================================================================
    -- listBooksInGroup: feeds the group-cover composer
    -- =====================================================================
    describe("listBooksInGroup", function()
        local store
        before_each(function()
            store = LibraryStore.new({ user_id = "alice" })
            -- Same fixture as listBookshelfGroups: nested Fantasy tree.
            store:upsertBook(book({ hash = "f1", title = "Conan",        group_name = "Fantasy",                cloud_present = 1, last_read_at = T_OLD,    updated_at = T_OLD }))
            store:upsertBook(book({ hash = "t1", title = "Hobbit",       group_name = "Fantasy/Tolkien",        cloud_present = 1, last_read_at = T_RECENT, updated_at = T_RECENT }))
            store:upsertBook(book({ hash = "t2", title = "Silmarillion", group_name = "Fantasy/Tolkien",        cloud_present = 1, last_read_at = T_MID,    updated_at = T_MID }))
            store:upsertBook(book({ hash = "l1", title = "FotR",         group_name = "Fantasy/Tolkien/LOTR",   cloud_present = 1, last_read_at = T_RECENT, updated_at = T_RECENT }))
            store:upsertBook(book({ hash = "s1", title = "Dune",         group_name = "SciFi",                  cloud_present = 1 }))
            store:upsertBook(book({ hash = "a1", title = "Foundation",   author = "Asimov",                     cloud_present = 1 }))
            store:upsertBook(book({ hash = "a2", title = "Robots",       author = "Asimov",                     cloud_present = 1 }))
            store:upsertBook(book({ hash = "a3", title = "Empire",       author = "Asimov",                     cloud_present = 1 }))
        end)
        after_each(function() store:close() end)

        it("group_name root: includes books across the whole subtree", function()
            local books = store:listBooksInGroup("group_name", "Fantasy", 4)
            local titles = {}
            for _, b in ipairs(books) do titles[b.title] = true end
            -- All four Fantasy-subtree books visible (Conan + Hobbit + Silmarillion + FotR)
            assert.is_true(titles["Conan"])
            assert.is_true(titles["Hobbit"])
            assert.is_true(titles["Silmarillion"])
            assert.is_true(titles["FotR"])
        end)

        it("group_name: respects limit", function()
            local books = store:listBooksInGroup("group_name", "Fantasy", 2)
            assert.are.equal(2, #books)
            -- Sorted by COALESCE(updated_at, last_read_at) DESC,
            -- so the two T_RECENT books come first (Hobbit + FotR).
            local titles = {}
            for _, b in ipairs(books) do titles[b.title] = true end
            assert.is_true(titles["Hobbit"] or titles["FotR"])
        end)

        it("author: matches just that author", function()
            local books = store:listBooksInGroup("author", "Asimov", 4)
            assert.are.equal(3, #books)
        end)

        it("group_name nested path: only its own subtree", function()
            local books = store:listBooksInGroup("group_name", "Fantasy/Tolkien", 4)
            local titles = {}
            for _, b in ipairs(books) do titles[b.title] = true end
            -- Hobbit + Silmarillion (direct) + FotR (descendant) = 3
            assert.are.equal(3, #books)
            assert.is_true(titles["Hobbit"])
            assert.is_true(titles["Silmarillion"])
            assert.is_true(titles["FotR"])
            assert.is_nil(titles["Conan"])  -- direct child of Fantasy, not Tolkien
        end)
    end)

    -- =====================================================================
    -- Multi-account scoping
    -- =====================================================================
    describe("multi-account", function()
        it("scopes books by user_id; alice's books invisible to bob", function()
            local DataStorage = require("datastorage")
            local path = DataStorage:getSettingsDir() .. "/multi.sqlite3"

            local alice = LibraryStore.new({ user_id = "alice", db_path = path })
            alice:upsertBook(book({ hash = "h1", title = "Alice's Book", cloud_present = 1 }))
            assert.are.equal(1, #alice:listBooks({}))
            alice:close()

            local bob = LibraryStore.new({ user_id = "bob", db_path = path })
            assert.are.equal(0, #bob:listBooks({}))
            bob:upsertBook(book({ hash = "h1", title = "Bob's Book", cloud_present = 1 }))
            assert.are.equal(1, #bob:listBooks({}))
            assert.are.equal("Bob's Book", bob:listBooks({})[1].title)
            bob:close()

            -- Re-open as alice; her copy of h1 still says "Alice's Book"
            local alice2 = LibraryStore.new({ user_id = "alice", db_path = path })
            assert.are.equal("Alice's Book", alice2:listBooks({})[1].title)
            alice2:close()
        end)

        it("scopes sync_state by user_id", function()
            local DataStorage = require("datastorage")
            local path = DataStorage:getSettingsDir() .. "/state.sqlite3"

            local alice = LibraryStore.new({ user_id = "alice", db_path = path })
            alice:setLastPulledAt(T_RECENT)
            alice:close()

            local bob = LibraryStore.new({ user_id = "bob", db_path = path })
            assert.is_nil(bob:getLastPulledAt())
            bob:setLastPulledAt(T_OLD)
            assert.are.equal(T_OLD, bob:getLastPulledAt())
            bob:close()

            local alice2 = LibraryStore.new({ user_id = "alice", db_path = path })
            assert.are.equal(T_RECENT, alice2:getLastPulledAt())
            alice2:close()
        end)
    end)

    -- =====================================================================
    -- Sync state
    -- =====================================================================
    describe("sync state", function()
        local store
        before_each(function() store = LibraryStore.new({ user_id = "alice" }) end)
        after_each(function() store:close() end)

        it("getLastPulledAt returns nil before any setLastPulledAt", function()
            assert.is_nil(store:getLastPulledAt())
        end)

        it("setLastPulledAt round-trips", function()
            store:setLastPulledAt(T_RECENT)
            assert.are.equal(T_RECENT, store:getLastPulledAt())
        end)
    end)

    -- =====================================================================
    -- parseSyncRow: pure helper, no DB access required
    -- =====================================================================
    describe("parseSyncRow", function()
        local DUMMY_HASH = "00000000000000000000000000000000"

        it("returns nil for the dummy initial-sync hash", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = DUMMY_HASH,
                title = "Dummy", format = "EPUB", author = "",
                deleted_at = "2026-01-01T00:00:00Z",
            })
            assert.is_nil(out)
        end)

        it("maps snake_case fields to our internal row shape", function()
            local out = LibraryStore.parseSyncRow({
                book_hash    = "h1",
                meta_hash    = "m1",
                title        = "Foundation",
                source_title = "Foundation (Original)",
                author       = "Asimov",
                format       = "EPUB",
                group_id     = "gid1",
                group_name   = "Sci-Fi/Classics",
                uploaded_at  = "2026-01-01T00:00:00Z",
                updated_at   = "2026-02-01T00:00:00Z",
                created_at   = "2025-12-01T00:00:00Z",
                deleted_at   = nil,
            })
            assert.are.equal("h1", out.hash)
            assert.are.equal("m1", out.meta_hash)
            assert.are.equal("Foundation", out.title)
            assert.are.equal("Foundation (Original)", out.source_title)
            assert.are.equal("Asimov", out.author)
            assert.are.equal("EPUB", out.format)
            assert.are.equal("gid1", out.group_id)
            assert.are.equal("Sci-Fi/Classics", out.group_name)
            assert.are.equal(1, out.cloud_present)
            assert.is_nil(out.deleted_at)
        end)

        it("converts ISO timestamps to unix ms", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
                uploaded_at = "2026-01-01T00:00:00Z",
                deleted_at = nil,
            })
            -- 2026-02-01T00:00:00Z = 1769904000 unix seconds
            -- 2026-01-01T00:00:00Z = 1767225600 unix seconds
            assert.are.equal(1769904000000, out.updated_at)
            assert.are.equal(1767225600000, out.uploaded_at)
        end)

        it("accepts Supabase / Postgres timestamps with +HH:MM offset", function()
            -- This is the format Supabase actually emits in /sync responses;
            -- discovered when 1221 cloud books all came back with
            -- updated_at=NULL because the parser only matched Z-suffix.
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00+00:00",
                uploaded_at = "2024-07-13T16:00:00.123456+00:00",
            })
            assert.are.equal(1769904000000, out.updated_at)
            -- 2024-07-13T16:00:00.123 UTC = 1720886400.123 sec → 1720886400123 ms
            assert.are.equal(1720886400123, out.uploaded_at)
        end)

        it("accepts non-UTC offsets and shifts back to UTC", function()
            -- "+05:30" means the wall-clock is 5h30m ahead of UTC; subtract
            -- to get unix epoch (which is always UTC).
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T05:30:00+05:30",
            })
            assert.are.equal(1769904000000, out.updated_at)
        end)

        it("accepts Postgres native (space separator, no T)", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01 00:00:00+00",
            })
            assert.are.equal(1769904000000, out.updated_at)
        end)

        it("JSON-parses metadata string and extracts series/series_index", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
                metadata = '{"series":"Foundation","seriesIndex":1.0,"description":"hello"}',
            })
            assert.are.equal("Foundation", out.series)
            assert.are.equal(1.0, out.series_index)
            assert.is_string(out.metadata_json)
            -- Round-trip the JSON and check the description survives
            local json = require("json")
            assert.are.equal("hello", json.decode(out.metadata_json).description)
        end)

        it("accepts metadata as an already-parsed table (not just a string)", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
                metadata = { series = "Dune", seriesIndex = 2 },
            })
            assert.are.equal("Dune", out.series)
            assert.are.equal(2, out.series_index)
        end)

        it("handles missing metadata gracefully", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
            })
            assert.is_nil(out.series)
            assert.is_nil(out.series_index)
            assert.is_nil(out.metadata_json)
        end)

        it("non-null deleted_at sets cloud_present=0 and preserves deleted_at", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
                deleted_at = "2026-02-15T00:00:00Z",
            })
            assert.are.equal(0, out.cloud_present)
            assert.are.equal(1771113600000, out.deleted_at)
            assert.is_true(out._force_cloud_present)
        end)

        it("preserves null group_name without crashing", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
                group_name = nil,
            })
            assert.is_nil(out.group_name)
        end)

        it("stringifies progress tuple to progress_lib JSON", function()
            local out = LibraryStore.parseSyncRow({
                book_hash = "h1", title = "T", format = "EPUB", author = "A",
                updated_at = "2026-02-01T00:00:00Z",
                progress = { 42, 250 },
            })
            local json = require("json")
            local p = json.decode(out.progress_lib)
            assert.are.equal(42, p[1])
            assert.are.equal(250, p[2])
        end)
    end)
end)
