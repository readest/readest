-- smoke_spec.lua
-- Minimal sanity check that the busted harness + spec_helper are wired up.
-- If this passes we know:
--   1. busted finds spec files via .busted ROOT/pattern
--   2. spec_helper preloads run (KOReader stubs available globally)
--   3. The lua-ljsqlite3/init shim works against an in-memory SQLite DB
-- Other spec files can then assume all of the above.

local helper = require("spec_helper")

describe("spec harness smoke test", function()
    before_each(function()
        helper.reset()
    end)

    it("runs at all", function()
        assert.are.equal(4, 2 + 2)
    end)

    it("exposes G_reader_settings as a global", function()
        assert.is_not_nil(_G.G_reader_settings)
        G_reader_settings:saveSetting("hello", "world")
        assert.are.equal("world", G_reader_settings:readSetting("hello"))
    end)

    it("reset wipes G_reader_settings between tests", function()
        assert.is_nil(G_reader_settings:readSetting("hello"))
    end)

    it("DataStorage:getSettingsDir() returns a usable temp dir", function()
        local DataStorage = require("datastorage")
        local dir = DataStorage:getSettingsDir()
        assert.is_string(dir)
        assert.is_truthy(dir:match("^/tmp/readest%-koplugin%-spec%-"))
        -- Confirm we can write into it
        local f = assert(io.open(dir .. "/probe.txt", "w"))
        f:write("ok")
        f:close()
        local r = assert(io.open(dir .. "/probe.txt", "r"))
        assert.are.equal("ok", r:read("*a"))
        r:close()
    end)

    it("opens an in-memory SQLite via the lua-ljsqlite3 shim", function()
        local SQ3 = require("lua-ljsqlite3/init")
        local db = SQ3.open(":memory:")
        db:exec([[
            CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
            INSERT INTO t (id, name) VALUES (1, 'alpha'), (2, 'beta');
        ]])

        -- rowexec helper
        assert.are.equal(2, db:rowexec("SELECT COUNT(*) FROM t"))

        -- prepare/bind/step round-trip
        local sel = db:prepare("SELECT name FROM t WHERE id = ?")
        local row = sel:reset():bind1(1, 1):step()
        assert.is_table(row)
        assert.are.equal("alpha", row[1])

        row = sel:reset():bind1(1, 2):step()
        assert.are.equal("beta", row[1])

        -- step returns nil after exhausting matches
        local none = sel:reset():bind1(1, 999):step()
        assert.is_nil(none)

        sel:close()
        db:close()
    end)

    it("logger stub is silently callable", function()
        local logger = require("logger")
        assert.has_no.errors(function()
            logger.warn("a warning")
            logger.info("an info")
            logger.dbg("debug")
            logger.err("an error")
        end)
    end)
end)
