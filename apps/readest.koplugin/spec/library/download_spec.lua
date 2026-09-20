require("spec_helper")
local stubs = require("spec.koreader_stubs")

describe("background book download", function()
    local syncbooks, saved, child, done, result, fork_ok, cancelled, tmp, opts, book
    local function swap(name, value)
        saved[name] = package.loaded[name]
        package.loaded[name] = value
    end
    before_each(function()
        stubs.reset()
        saved = {}
        child, done, result, cancelled = nil, false, nil, false
        fork_ok = true
        tmp = os.tmpname()
        os.remove(tmp)
        require("lfs").mkdir(tmp)
        swap("ffi/util", {
            runInSubProcess = function(fn)
                child = fn
                if fork_ok then return 123, 42 end
                return false
            end,
            isSubProcessDone = function() return done end,
            readAllFromFD = function() return result or "" end,
            writeToFD = function(_, value) result = value end,
            terminateSubProcess = function() cancelled = true end,
        })
        swap("ffi", { cdef = function() end, C = { _exit = function() end } })
        swap("socket", { skip = function(_, _, ...) return ... end })
        swap("socketutil", { set_timeout = function() end, reset_timeout = function() end })
        swap("ltn12", { sink = { file = function(f)
            return function(chunk) if chunk then return f:write(chunk) else return f:close() end end
        end } })
        swap("socket.http", { request = function(req)
            req.sink("book contents")
            req.sink(nil)
            return 1, 200
        end })
        package.loaded["library.syncbooks"] = nil
        syncbooks = require("library.syncbooks")
        book = { hash = "h1", title = "Book", format = "EPUB" }
        opts = {
            settings = { user_id = "alice" }, download_dir = tmp,
            sync_auth = {
                withFreshToken = function(_, _, _, cb) cb(true) end,
                getReadestSyncClient = function() return {
                    getDownloadUrl = function(_, _, cb) cb(true, { downloadUrl = "https://example.test/book" }) end,
                } end,
            },
        }
    end)
    after_each(function()
        for name, value in pairs(saved) do package.loaded[name] = value end
        -- Uncached modules are removed too.
        for _, name in ipairs({ "ffi/util", "ffi", "socket", "socketutil", "ltn12", "socket.http" }) do
            if saved[name] == nil then package.loaded[name] = nil end
        end
        package.loaded["library.syncbooks"] = nil
        for file in require("lfs").dir(tmp) do
            if file ~= "." and file ~= ".." then os.remove(tmp .. "/" .. file) end
        end
        require("lfs").rmdir(tmp)
    end)

    it("returns to the UI before transferring and publishes the file only after success", function()
        local calls, path = 0
        syncbooks.downloadBook(book, opts, function(ok, dst)
            assert.is_true(ok); calls = calls + 1; path = dst
        end)
        assert.is_function(child)
        assert.are.equal(0, calls)
        child(123, 42)
        assert.is_nil(require("lfs").attributes(tmp .. "/Book.epub"))
        done = true
        stubs.UIManager:drain()
        assert.are.equal(1, calls)
        local f = assert(io.open(path, "rb"))
        assert.are.equal("book contents", f:read("*a")); f:close()
    end)

    it("reports bytes while running without blocking the next UI tick", function()
        local bytes
        opts.on_progress = function(value) bytes = value end
        syncbooks.downloadBook(book, opts, function() end)
        child(123, 42)
        stubs.UIManager:drain()
        assert.are.equal(13, bytes)
        assert.are.equal(1, #stubs.UIManager._scheduled)
    end)

    it("removes partial files and reports HTTP failures", function()
        package.loaded["socket.http"].request = function(req)
            req.sink("error body"); req.sink(nil); return 1, 404
        end
        local success, status
        syncbooks.downloadBook(book, opts, function(ok, _, code) success, status = ok, code end)
        child(123, 42); done = true; stubs.UIManager:drain()
        assert.is_false(success)
        assert.are.equal(404, status)
        assert.is_nil(require("lfs").attributes(tmp .. "/Book.epub"))
        assert.is_nil(require("lfs").attributes(tmp .. "/Book.epub.part"))
    end)

    it("cancels a running transfer and reaps it before cleanup", function()
        local success, err
        local cancel = syncbooks.downloadBook(book, opts, function(ok, msg) success, err = ok, msg end)
        child(123, 42)
        cancel()
        assert.is_true(cancelled)
        assert.is_nil(success)
        done = true; stubs.UIManager:drain()
        assert.is_false(success)
        assert.are.equal("cancelled", err)
        assert.is_nil(require("lfs").attributes(tmp .. "/Book.epub.part"))
    end)

    it("reports fork failure without a synchronous fallback", function()
        fork_ok = false
        local success
        syncbooks.downloadBook(book, opts, function(ok) success = ok end)
        assert.is_false(success)
    end)
end)
