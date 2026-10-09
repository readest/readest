-- syncconfig_spec.lua
-- Tests for SyncConfig's metadata hash — the cross-device book fingerprint
-- that must stay CONSISTENT with Readest's getMetadataHashInfo in
-- apps/readest-app/src/utils/book.ts. The hash-source fixtures here mirror
-- src/__tests__/utils/metadata-hash-info.test.ts: same inputs must produce
-- the same "title|authors|identifiers[|pdf-filename]" string on both sides,
-- because md5 of that string is the fleet-wide book identity.
--
-- Expected hashes are computed through the same (stubbed) ffi/sha2 module the
-- production code holds, so assertions pin the exact hash INPUT — md5 itself
-- is identical in both languages.

require("spec_helper")
require("spec.koreader_stubs")

local SyncConfig = require("readest_syncconfig")
local sha2 = require("ffi/sha2")

-- Minimal ui fake: doc_settings backed by a plain table, so getMetaHash's
-- cache writes are observable.
local function fakeUI(o)
    o = o or {}
    local values = {
        doc_props = o.doc_props or {},
        doc_path = o.doc_path,
        partial_md5_checksum = o.checksum,
        readest_sync = o.readest_sync,
    }
    return {
        doc_settings = {
            readSetting = function(_, k) return values[k] end,
            saveSetting = function(_, k, v) values[k] = v end,
        },
        _values = values,
    }
end

local function fakeStore(rows)
    return {
        _getRowRaw = function(_, hash) return rows[hash] end,
    }
end

describe("SyncConfig:getMetadataHashInfo", function()
    it("builds the same hash source as Readest for a plain book", function()
        local ui = fakeUI({
            doc_props = {
                title = "The Great Gatsby",
                authors = "F. Scott Fitzgerald",
                identifiers = "9780743273565",
            },
            doc_path = "/books/gatsby.epub",
        })
        local info = SyncConfig:getMetadataHashInfo(ui)
        assert.are.equal("The Great Gatsby|F. Scott Fitzgerald|9780743273565", info.hash_source)
        assert.are.equal(sha2.md5("The Great Gatsby|F. Scott Fitzgerald|9780743273565"),
            info.meta_hash)
    end)

    it("salts PDF hashes with the base filename (issue #5411)", function()
        local props = { title = "PowerPoint Presentation", authors = "Alice Author" }
        local pdf = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-01.pdf",
        }))
        assert.are.equal("PowerPoint Presentation|Alice Author||lecture-01", pdf.hash_source)
    end)

    it("does not salt non-PDF formats", function()
        local props = { title = "PowerPoint Presentation", authors = "Alice Author" }
        local epub = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-01.epub",
        }))
        assert.are.equal("PowerPoint Presentation|Alice Author|", epub.hash_source)
    end)

    it("gives distinct PDFs with identical metadata distinct hashes", function()
        local props = { title = "PowerPoint Presentation", authors = "Alice Author" }
        local a = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-01.pdf",
        }))
        local b = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = props, doc_path = "/books/lecture-02.pdf",
        }))
        assert.are_not.equal(a.meta_hash, b.meta_hash)
    end)

    it("keeps the salt when the title already fell back to the filename", function()
        -- Readest hashes "report||" + "|report" for a metadata-less PDF: the
        -- title fallback happens before hashing, then the salt is appended
        -- regardless. Same double appearance here.
        local info = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = {}, doc_path = "/books/report.pdf",
        }))
        assert.are.equal("report|||report", info.hash_source)
    end)

    it("prefers uuid over other identifier schemes regardless of order", function()
        -- Readest's getPreferredIdentifier walks schemes in priority order
        -- (uuid > calibre > isbn); the identifier listing order must not
        -- change the winner.
        local first = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = { title = "T", identifiers = "urn:uuid:abc\ncalibre:99" },
            doc_path = "/books/t.epub",
        }))
        local second = SyncConfig:getMetadataHashInfo(fakeUI({
            doc_props = { title = "T", identifiers = "calibre:99\nurn:uuid:abc" },
            doc_path = "/books/t.epub",
        }))
        assert.are.same({ "abc" }, first.identifiers)
        assert.are.same({ "abc" }, second.identifiers)
    end)
end)

describe("SyncConfig:getMetaHash", function()
    it("prefers the library store's synced meta_hash over local computation", function()
        -- The value stamped when the book entered the fleet is authoritative
        -- (Readest never recomputes it after import — the PDF filename salt
        -- is unrecoverable). A pulled row must beat anything computed here.
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.pdf",
            checksum = "b1",
        })
        local store = fakeStore({ b1 = { meta_hash = "cloud-stamped" } })
        assert.are.equal("cloud-stamped", SyncConfig:getMetaHash(ui, store))
        -- Cached so annotation flows reading meta_hash_v1 directly agree.
        assert.are.equal("cloud-stamped", ui._values.readest_sync.meta_hash_v1)
    end)

    it("replaces a stale locally-computed cache with the synced value", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.pdf",
            checksum = "b1",
            readest_sync = { meta_hash_v1 = "old-local" },
        })
        local store = fakeStore({ b1 = { meta_hash = "cloud-stamped" } })
        assert.are.equal("cloud-stamped", SyncConfig:getMetaHash(ui, store))
        assert.are.equal("cloud-stamped", ui._values.readest_sync.meta_hash_v1)
    end)

    it("falls back to the cached hash when the store has no row", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.pdf",
            checksum = "b1",
            readest_sync = { meta_hash_v1 = "cached" },
        })
        assert.are.equal("cached", SyncConfig:getMetaHash(ui, fakeStore({})))
    end)

    it("computes and caches when neither store nor cache has a value", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.epub",
            checksum = "b1",
        })
        assert.are.equal(sha2.md5("Dune||"), SyncConfig:getMetaHash(ui, fakeStore({})))
        assert.are.equal(sha2.md5("Dune||"), ui._values.readest_sync.meta_hash_v1)
    end)

    it("ignores an empty meta_hash on the store row", function()
        local ui = fakeUI({
            doc_props = { title = "Dune" },
            doc_path = "/books/dune.epub",
            checksum = "b1",
        })
        local store = fakeStore({ b1 = { meta_hash = "" } })
        assert.are.equal(sha2.md5("Dune||"), SyncConfig:getMetaHash(ui, store))
    end)
end)

describe("SyncConfig delayed responses", function()
    it("ignores a reading-position response after closing the document", function()
        local ui = fakeUI()
        ui.document = {}
        local response
        local client = {pullChanges = function(_, _, cb) response = cb end}
        SyncConfig:pull(ui, {}, client, "book", "meta", false)
        ui.document = nil
        response(true, {configs = {}})
        assert.is_nil(ui._values.readest_sync)
    end)
end)

describe("SyncConfig progress conflicts", function()
    local ui, events, page
    before_each(function()
        require("spec.koreader_stubs").reset()
        ui = fakeUI({ checksum = "book", readest_sync = { meta_hash_v1 = "meta" } })
        events, page = {}, 50
        ui.document = { info = { has_pages = true }, getPageCount = function() return 100 end }
        ui.getCurrentPage = function() return page end
        ui.link = { addCurrentLocationToStack = function() end }
        ui.handleEvent = function(_, event) events[#events + 1] = event end
    end)
    it("moves a paged document backward only on an explicit pull", function()
        assert.is_true(SyncConfig:applyBookConfig(ui, { progress = "[ 20, 100 ]" }, false))
        assert.are.equal(0, #events)
        assert.is_true(SyncConfig:applyBookConfig(ui, { progress = "[ 20, 100 ]" }, true))
        assert.are.equal(1, #events)
    end)
    it("moves an EPUB backward only on an explicit pull and catches invalid XPointers", function()
        ui.document.info.has_pages = false
        ui.rolling = { getLastProgress = function() return "/body/current" end }
        ui.document.compareXPointers = function(_, _, pointer)
            if pointer == "/invalid" then error("invalid pointer") end
            return -1
        end
        assert.is_true(SyncConfig:applyBookConfig(ui, { xpointer = "/body/earlier" }, false))
        assert.are.equal(0, #events)
        assert.is_true(SyncConfig:applyBookConfig(ui, { xpointer = "/body/earlier" }, true))
        assert.are.equal(1, #events)
        assert.is_false(SyncConfig:applyBookConfig(ui, { xpointer = "/invalid" }, true))
    end)
    it("does not jump back to a parent node when an explicit pull trims the XPointer", function()
        ui.document.info.has_pages = false
        ui.rolling = { getLastProgress = function() return "/body/DocFragment[5]/body/p[30]" end }
        -- Only the chapter resolves; crengine orders a parent before its children.
        ui.document.compareXPointers = function(_, _, pointer)
            if pointer ~= "/body/DocFragment[5]" then return nil end
            return -1
        end
        assert.is_true(SyncConfig:applyBookConfig(ui,
            { xpointer = "/body/DocFragment[5]/body/p[99]/text().4" }, true))
        assert.are.equal(0, #events)
    end)
    it("reports a position whose chapter is missing instead of falling back to /body", function()
        ui.document.info.has_pages = false
        ui.rolling = { getLastProgress = function() return "/body/DocFragment[7]/body/p[80]" end }
        -- The document root resolves in any book, so it locates nothing.
        ui.document.compareXPointers = function(_, _, pointer)
            if pointer ~= "/body" then return nil end
            return -1
        end
        local xpointer = "/body/DocFragment[999]/body/div/p[5]/text().0"
        assert.is_false(SyncConfig:applyBookConfig(ui, { xpointer = xpointer }, true))
        assert.is_false(SyncConfig:applyBookConfig(ui, { xpointer = xpointer }, false))
        assert.are.equal(0, #events)
    end)
    it("rejects out-of-range positions and missing reflowable xpointers", function()
        assert.is_false(SyncConfig:applyBookConfig(ui, { progress = "[200,100]" }))
        ui.document.info.has_pages = false
        assert.is_false(SyncConfig:applyBookConfig(ui, { xpointer = "" }))
        assert.are.equal(0, #events)
    end)
    it("does not apply an automatic response after the user turns a page", function()
        local pending
        SyncConfig:pull(ui, {}, { pullChanges = function(_, _, cb) pending = cb end }, "book", "meta", false)
        page = 51
        pending(true, { configs = { { progress = "[80,100]" } } })
        assert.are.equal(0, #events)
    end)
    local function useReflowable()
        ui.document.info.has_pages = false
        local pointer = "/body/current"
        ui.rolling = { getLastProgress = function() return pointer end }
        ui.document.compareXPointers = function(_, a, b)
            if a == b or (a == "/body/current" and b == "/body/current-equivalent") then return 0 end
            return 1
        end
        return function(value) pointer = value end
    end
    local function pullResponse(interactive)
        local pending
        SyncConfig:pull(ui, {}, { pullChanges = function(_, _, cb) pending = cb end }, "book", "meta", interactive)
        return function() pending(true, { configs = { { xpointer = "/body/remote" } } }) end
    end
    it("applies automatic EPUB pulls after reflow changes the page number", function()
        useReflowable()
        local receive = pullResponse(false)
        page = 42 -- rotation or a font change, with the logical position unchanged
        receive()
        assert.are.equal(1, #events)
        assert.are.equal("GotoXPointer", events[1].name)
    end)
    it("drops automatic EPUB pulls after navigation even within the same page", function()
        local setPointer = useReflowable()
        local receive = pullResponse(false)
        setPointer("/body/later") -- scrolling need not change the page number
        receive()
        assert.are.equal(0, #events)
    end)
    it("accepts equivalent logical positions after an EPUB layout change", function()
        local setPointer = useReflowable()
        local receive = pullResponse(false)
        page = 60
        setPointer("/body/current-equivalent")
        receive()
        assert.are.equal(1, #events)
    end)
    it("allows a pull during initial reflow before the first XPointer is established", function()
        local setPointer = useReflowable()
        setPointer(nil)
        local receive = pullResponse(false)
        page = 42
        setPointer("/body/current")
        receive()
        assert.are.equal(1, #events)
    end)
    it("honors a forward explicit pull even if the user navigates during the request", function()
        local setPointer = useReflowable()
        local receive = pullResponse(true)
        setPointer("/body/later")
        receive()
        assert.are.equal(1, #events)
    end)
    it("suppresses pull and push failure toasts when authentication owns the prompt", function()
        local stubs = require("spec.koreader_stubs")
        local rejected = { error = "authentication required", auth_required = true }
        local client = {
            pullChanges = function(_, _, cb) cb(false, rejected, 401) end,
            pushChanges = function(_, _, cb) cb(false, rejected, 401) end,
        }
        local done
        SyncConfig:pull(ui, {}, client, "book", "meta", true)
        assert.are.equal(1, #stubs.UIManager._shown) -- pulling notice only
        SyncConfig:push(ui, {}, client, true, 0, function(ok) done = ok end)
        assert.are.equal(2, #stubs.UIManager._shown) -- pushing notice only
        assert.is_false(done)
    end)
    it("respects a competing device's winning position without scheduling a retry", function()
        for _, remote_offset in ipairs({ 0, 1, 3600000 }) do
            local count, result = 0, nil
            local client = { pushChanges = function(_, payload, cb)
                count = count + 1
                cb(true, { configs = { { updated_at = payload.configs[1].updatedAt + remote_offset,
                    progress = "[80,100]" } } })
            end }
            SyncConfig:push(ui, {}, client, true, 0, function(ok) result = ok end)
            assert.are.equal(1, count)
            assert.is_true(result)
            assert.is_true(SyncConfig:getCurrentBookConfig(ui).updatedAt < (os.time() + 1) * 1000)
        end
    end)
    it("does not force a re-push for cosmetically different EPUB xpointers", function()
        local count = 0
        ui.document.info.has_pages = false
        ui.rolling = { getLastProgress = function() return "/body/p[1]/text().0" end }
        local client = { pushChanges = function(_, payload, cb)
            count = count + 1
            cb(true, { configs = { { updated_at = payload.configs[1].updatedAt,
                xpointer = "/body/p/text().0" } } })
        end }
        SyncConfig:push(ui, {}, client, false, 0)
        assert.are.equal(1, count)
    end)
    it("does not inherit a future server clock on pull", function()
        local future = (os.time() + 31536000) * 1000
        local client = { pullChanges = function(_, _, cb)
            cb(true, { configs = { { updated_at = future, progress = "[50,100]" } } })
        end }
        SyncConfig:pull(ui, {}, client, "book", "meta", false)
        assert.is_nil(ui._values.readest_sync.config_clock)
        assert.are.equal(os.time() * 1000, SyncConfig:getCurrentBookConfig(ui).updatedAt)
    end)
    it("discards persisted future clocks and recovers after a device clock correction", function()
        ui._values.readest_sync.config_clock = (os.time() + 31536000) * 1000
        local stamps = {}
        local client = { pushChanges = function(_, payload, cb)
            stamps[#stamps + 1] = payload.configs[1].updatedAt
            cb(true, {})
        end }
        local original_time, now = os.time, os.time()
        os.time = function() return now end
        local ok, err = pcall(function()
            SyncConfig:push(ui, {}, client, false, 0)
            assert.are.equal(now * 1000, stamps[1])
            SyncConfig:push(ui, {}, client, false, 0)
            assert.are.equal(stamps[1] + 1, stamps[2])
            now = now - 3600
            SyncConfig:push(ui, {}, client, false, 0)
            assert.are.equal(now * 1000, stamps[3])
            assert.are.equal(stamps[3], ui._values.readest_sync.config_clock)
        end)
        os.time = original_time
        assert.is_true(ok, err)
    end)
    it("bounds the same-second clock instead of letting rapid pushes drift indefinitely", function()
        ui._values.readest_sync.config_clock = os.time() * 1000 + 1000
        assert.are.equal(os.time() * 1000, SyncConfig:getCurrentBookConfig(ui).updatedAt)
    end)
    it("builds the payload with the library hash without pre-staging identifiers", function()
        ui._values.readest_sync.meta_hash_v1 = "old-local"
        local store = fakeStore({ book = { meta_hash = "cloud-stamped" } })
        local config = SyncConfig:getCurrentBookConfig(ui, store)
        assert.are.equal("cloud-stamped", config.metaHash)
        ui._values.readest_sync.meta_hash_v1 = "old-local-again"
        SyncConfig:push(ui, {}, { pushChanges = function(_, payload, cb)
            assert.are.equal("cloud-stamped", payload.configs[1].metaHash)
            cb(true, {})
        end }, false, 0, nil, store)
        assert.are.equal("cloud-stamped", ui._values.readest_sync.meta_hash_v1)
    end)
    it("does not retry an older in-flight position over a newer push", function()
        local callbacks, count = {}, 0
        local client = { pushChanges = function(_, _, cb) count = count + 1; callbacks[count] = cb end }
        SyncConfig:push(ui, {}, client, false, 0)
        page = 60
        SyncConfig:push(ui, {}, client, false, 0)
        callbacks[1](true, { configs = { { updated_at = (os.time() + 3600) * 1000, progress = "[70,100]" } } })
        assert.are.equal(2, count)
    end)
    it("writes a completed push to its original book after the UI changes books", function()
        local pending, settings = nil, ui.doc_settings
        SyncConfig:push(ui, {}, { pushChanges = function(_, _, cb) pending = cb end }, false, 0)
        ui.doc_settings = fakeUI().doc_settings
        pending(true, {})
        assert.truthy(settings:readSetting("readest_sync").last_synced_at_config)
        assert.is_nil(ui.doc_settings:readSetting("readest_sync"))
    end)
end)
