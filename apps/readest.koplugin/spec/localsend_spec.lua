require("spec_helper")
require("spec.koreader_stubs")

describe("localsend_helper.binaryNameFor", function()
    local Helper = require("library.localsend_helper")

    it("picks the armv7 binary on Kindle arm", function()
        assert.equals("localsend-helper-armv7",
            Helper.binaryNameFor({ is_kindle = true, os = "Linux", arch = "arm" }))
    end)

    it("picks the armv7 binary on Kobo arm", function()
        assert.equals("localsend-helper-armv7",
            Helper.binaryNameFor({ is_kobo = true, os = "Linux", arch = "arm" }))
    end)

    it("picks the armv7 binary on reMarkable arm", function()
        assert.equals("localsend-helper-armv7",
            Helper.binaryNameFor({ is_remarkable = true, os = "Linux", arch = "arm" }))
    end)

    it("picks the armv7 binary on any generic 32-bit arm Linux e-reader", function()
        assert.equals("localsend-helper-armv7",
            Helper.binaryNameFor({ os = "Linux", arch = "arm" }))
    end)

    it("picks the arm64 binary on generic arm64 Linux", function()
        assert.equals("localsend-helper-arm64",
            Helper.binaryNameFor({ os = "Linux", arch = "arm64" }))
    end)

    it("picks the macos binary on the arm64 macOS emulator", function()
        assert.equals("localsend-helper-macos",
            Helper.binaryNameFor({ is_emulator = true, os = "OSX", arch = "arm64" }))
    end)

    it("excludes Android arm64 (cannot exec a binary from app/external storage)", function()
        assert.is_nil(Helper.binaryNameFor({ is_android = true, os = "Linux", arch = "arm64" }))
    end)

    it("refuses other arches", function()
        assert.is_nil(Helper.binaryNameFor({ os = "Linux", arch = "x64" }))
    end)
end)

describe("localsend_helper.parseLines", function()
    local Helper = require("library.localsend_helper")

    it("decodes a single complete line", function()
        local events, remaining = Helper.parseLines("", '{"type":"started","port":1}\n')
        assert.equals(1, #events)
        assert.equals("started", events[1].type)
        assert.equals(1, events[1].port)
        assert.equals("", remaining)
    end)

    it("returns no events and buffers a partial line", function()
        local events, remaining = Helper.parseLines("", '{"type":"star')
        assert.equals(0, #events)
        assert.equals('{"type":"star', remaining)
    end)

    it("decodes two complete lines and buffers the trailing partial", function()
        local chunk = '{"type":"a"}\n{"type":"b"}\n{"type":"c"'
        local events, remaining = Helper.parseLines("", chunk)
        assert.equals(2, #events)
        assert.equals("a", events[1].type)
        assert.equals("b", events[2].type)
        assert.equals('{"type":"c"', remaining)
    end)

    it("skips a bad-JSON line but keeps decoding the rest", function()
        local chunk = 'not json at all\n{"type":"ok"}\n'
        local events, remaining = Helper.parseLines("", chunk)
        assert.equals(1, #events)
        assert.equals("ok", events[1].type)
        assert.equals("", remaining)
    end)

    it("carries the buffer across calls when a line is split across two reads", function()
        local events1, remaining1 = Helper.parseLines("", '{"type":"star')
        assert.equals(0, #events1)
        local events2, remaining2 = Helper.parseLines(remaining1, 'ted"}\n')
        assert.equals(1, #events2)
        assert.equals("started", events2[1].type)
        assert.equals("", remaining2)
    end)
end)

describe("localsend_helper.deviceLabel", function()
    local Helper = require("library.localsend_helper")

    it("shows alias, platform tag, then the ipv4 last octet", function()
        assert.equals("Pixel · Pixel 8 · #42", Helper.deviceLabel({
            alias = "Pixel", deviceModel = "Pixel 8", ipv4Host = "192.168.1.42",
        }))
    end)

    it("shows the platform tag as Readest does (e.g. macOS)", function()
        assert.equals("Readest · macOS · #120", Helper.deviceLabel({
            alias = "Readest", deviceModel = "macOS", ipv4Host = "192.168.2.120",
        }))
    end)

    it("omits the ipv4 octet when there's no ipv4Host", function()
        assert.equals("Pixel · Pixel 8", Helper.deviceLabel({
            alias = "Pixel", deviceModel = "Pixel 8",
        }))
    end)

    it("shows just the alias when there's no model or ipv4Host", function()
        assert.equals("Pixel", Helper.deviceLabel({ alias = "Pixel" }))
    end)

    it("falls back to deviceModel when alias is empty (not duplicated)", function()
        assert.equals("Galaxy Tab", Helper.deviceLabel({
            alias = "", deviceModel = "Galaxy Tab", ipv4Host = nil,
        }))
    end)
end)

describe("localsend_firewall.rules", function()
    local Firewall = require("library.localsend_firewall")

    it("returns the two INPUT accept rules LocalSend needs", function()
        local rules = Firewall.rules()
        assert.equals(2, #rules)
        assert.same({ "-p", "tcp", "--dport", "53317:53327", "-m", "conntrack",
            "--ctstate", "NEW,ESTABLISHED", "-j", "ACCEPT" }, rules[1])
        assert.same({ "-p", "udp", "--dport", "53317", "-j", "ACCEPT" }, rules[2])
    end)

    it("returns a fresh table each call so callers can't mutate cached state", function()
        local a = Firewall.rules()
        a[1].mutated = true
        local b = Firewall.rules()
        assert.is_nil(b[1].mutated)
    end)
end)

describe("readest_localsend dispatch", function()
    local LocalSend = require("readest_localsend")

    it("routes events to per-type handlers and ignores unknown types", function()
        local seen = {}
        local orig = LocalSend.handlers
        LocalSend.handlers = {
            receive_request = function(_, ev) seen.request = ev end,
            receive_end = function(_, ev) seen.done = ev end,
        }
        LocalSend:dispatch({ type = "receive_request", sessionId = "s1" })
        LocalSend:dispatch({ type = "receive_end", sessionId = "s1", received = 2 })
        LocalSend:dispatch({ type = "totally_unknown" })
        LocalSend.handlers = orig
        assert.equals("s1", seen.request.sessionId)
        assert.equals(2, seen.done.received)
    end)

    it("exposes handlers for every event the helper protocol emits", function()
        for _, t in ipairs({ "started", "status", "receive_request", "receive_request_closed",
                             "receive_file_done", "receive_end", "error",
                             "devices", "send_progress", "send_end" }) do
            assert.is_function(LocalSend.handlers[t], t)
        end
    end)

    it("error and started handlers run without shadowing the i18n function", function()
        -- Real handlers (not the dispatch test's temporary overrides). A
        -- first parameter named `_` would shadow the module-level i18n `_`
        -- and crash on `_("...")` inside the handler body. Both handlers
        -- must also be nil-safe when self.sock is nil (no service running,
        -- e.g. an error arrived before/without a successful startService):
        -- Helper.send() no-ops on a nil socket and stopService() only
        -- unschedules the (unscheduled) poll task.
        assert.is_nil(LocalSend.sock)
        assert.has_no.errors(function()
            LocalSend.handlers.error(LocalSend, { message = "boom" })
        end)
        assert.has_no.errors(function()
            LocalSend.handlers.started(LocalSend, { port = 53318 })
        end)
    end)
end)
