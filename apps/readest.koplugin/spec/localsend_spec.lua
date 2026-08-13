require("spec_helper")
require("spec.koreader_stubs")

describe("localsend_ffi.libNameFor", function()
    local FFIMod = require("library.localsend_ffi")

    it("picks the softfp .so on Kindle arm", function()
        assert.equals("liblocalsend-armv7.so",
            FFIMod.libNameFor({ is_kindle = true, os = "Linux", arch = "arm" }))
    end)

    it("picks the hardfloat .so on Kobo arm", function()
        assert.equals("liblocalsend-armv7hf.so",
            FFIMod.libNameFor({ is_kobo = true, os = "Linux", arch = "arm" }))
    end)

    it("picks the arm64 dylib on the macOS emulator", function()
        assert.equals("liblocalsend-arm64.dylib",
            FFIMod.libNameFor({ is_emulator = true, os = "OSX", arch = "arm64" }))
    end)

    it("refuses linux arm devices that are neither kindle nor kobo", function()
        assert.is_nil(FFIMod.libNameFor({ os = "Linux", arch = "arm" }))
    end)

    it("never crosses the softfp/hardfloat ABI boundary between kindle and kobo", function()
        assert.equals("liblocalsend-armv7.so",
            FFIMod.libNameFor({ is_kindle = true, arch = "arm" }))
        assert.equals("liblocalsend-armv7hf.so",
            FFIMod.libNameFor({ is_kobo = true, arch = "arm" }))
    end)

    it("refuses other arches", function()
        assert.is_nil(FFIMod.libNameFor({ is_kindle = true, os = "Linux", arch = "x64" }))
        assert.is_nil(FFIMod.libNameFor({ is_emulator = true, os = "Linux", arch = "arm64" }))
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

    it("exposes handlers for every event the ffi crate emits", function()
        for _, t in ipairs({ "started", "receive_request", "receive_request_closed",
                             "receive_file_done", "receive_end", "error" }) do
            assert.is_function(LocalSend.handlers[t], t)
        end
    end)

    it("error and started handlers run without shadowing the i18n function", function()
        -- Real handlers (not the dispatch test's temporary overrides). A
        -- first parameter named `_` would shadow the module-level i18n `_`
        -- and crash on `_("...")` inside the handler body.
        assert.has_no.errors(function()
            LocalSend.handlers.error(LocalSend, { message = "boom" })
        end)
        assert.has_no.errors(function()
            LocalSend.handlers.started(LocalSend, { port = 53318 })
        end)
    end)
end)
