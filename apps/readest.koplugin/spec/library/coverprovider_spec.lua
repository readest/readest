-- coverprovider_spec.lua
-- Pure-function tests for library/coverprovider.lua. The blitbuffer-returning
-- functions wrap BookInfoManager (coverbrowser plugin) and a streaming HTTP
-- download; both require live KOReader and are exercised manually.

require("spec_helper")

describe("library.coverprovider", function()
    local cp

    before_each(function()
        require("spec_helper").reset()
        package.loaded["library.coverprovider"] = nil
        cp = require("library.coverprovider")
    end)

    describe("coverbrowser_loaded", function()
        it("returns false when the covermenu module isn't on package.path", function()
            -- Make absolutely sure no leftover stub is hanging around
            package.loaded["covermenu"] = nil
            package.preload["covermenu"] = nil
            assert.is_false(cp.coverbrowser_loaded())
        end)

        it("returns true when the covermenu module IS available", function()
            package.preload["covermenu"] = function() return { _stub = true } end
            assert.is_true(cp.coverbrowser_loaded())
            package.preload["covermenu"] = nil
            package.loaded["covermenu"]  = nil
        end)
    end)

    describe("cached_cover_path", function()
        it("returns {covers_dir}/{hash}.png", function()
            assert.are.equal("/cache/abc123.png",
                cp.cached_cover_path("/cache", "abc123"))
        end)

        it("returns nil when either input is missing/empty", function()
            assert.is_nil(cp.cached_cover_path(nil, "h"))
            assert.is_nil(cp.cached_cover_path("/cache", nil))
            assert.is_nil(cp.cached_cover_path("", "h"))
            assert.is_nil(cp.cached_cover_path("/cache", ""))
        end)
    end)

    describe("MISSING sentinel", function()
        it("exposes a stable 'no cover available' marker", function()
            assert.is_string(cp.MISSING)
            assert.is_truthy(cp.MISSING)
            -- Truthy + distinguishable from any real path
            assert.are.equal("_missing", cp.MISSING)
        end)
    end)
end)
