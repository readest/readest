require("spec_helper")
local stubs = require("spec.koreader_stubs")

describe("library download queue", function()
    local queue, syncbooks, original_download, pending, calls, store, opts, saved_dialog
    local temp_db
    before_each(function()
        temp_db = nil
        stubs.reset()
        pending, calls = {}, {}
        saved_dialog = package.loaded["ui/widget/buttondialog"]
        package.loaded["ui/widget/buttondialog"] = {
            new = function(_, o)
                o.setTitle = function(self, title) self.title = title end
                return o
            end,
        }
        syncbooks = require("library.syncbooks")
        original_download = syncbooks.downloadBook
        syncbooks.downloadBook = function(book, options, cb)
            calls[#calls + 1] = book.hash
            pending[#pending + 1] = { cb = cb, opts = options }
            return function() cb(false, "cancelled") end
        end
        store = require("library.librarystore").new({user_id = "alice"})
        opts = {settings = {user_id = "alice", library_download_dir = "/books"}, store = store}
        package.loaded["library.downloadqueue"] = nil
        queue = require("library.downloadqueue")
    end)
    after_each(function()
        if queue then queue.cancel() end
        syncbooks.downloadBook = original_download
        package.loaded["ui/widget/buttondialog"] = saved_dialog
        package.loaded["library.downloadqueue"] = nil
        store:close()
        if temp_db then
            os.remove(temp_db)
            os.remove(temp_db .. "-wal")
            os.remove(temp_db .. "-shm")
        end
    end)
    local function books()
        return {{hash = "h1", title = "One"}, {hash = "h2", title = "Two"}}
    end
    it("queues sequentially, skips duplicates, and records successes", function()
        queue.start(books(), opts)
        queue.start(books(), opts)
        assert.are.equal(0, #calls)
        stubs.UIManager:drain()
        assert.same({"h1"}, calls)
        pending[1].cb(true, "/books/one.epub")
        stubs.UIManager:drain()
        assert.same({"h1", "h2"}, calls)
        pending[2].cb(true, "/books/two.epub")
        stubs.UIManager:drain()
        assert.is_false(queue.isRunning())
        assert.are.equal(2, #store:listBooks({}))
    end)
    it("continues after failure and supports progress while its dialog is hidden", function()
        queue.start(books(), opts)
        stubs.UIManager:drain()
        local dialog = stubs.UIManager._shown[#stubs.UIManager._shown]
        dialog.buttons[1][1].callback() -- Run in background
        pending[1].opts.on_progress(1024)
        pending[1].cb(false, "download failed", 500)
        stubs.UIManager:drain()
        assert.same({"h1", "h2"}, calls)
        queue.show()
        assert.is_true(queue.isRunning())
    end)
    it("cancels the current transfer and never starts queued books", function()
        queue.start(books(), opts)
        stubs.UIManager:drain()
        queue.cancel()
        stubs.UIManager:drain()
        assert.same({"h1"}, calls)
        assert.is_false(queue.isRunning())
        assert.are.equal(0, #store:listBooks({}))
    end)
    it("opens a single completed book only when the download remains in the foreground", function()
        local opened
        opts.on_open = function(path) opened = path end
        queue.start({books()[1]}, opts)
        stubs.UIManager:drain()
        pending[1].cb(true, "/books/one.epub")
        stubs.UIManager:drain()
        assert.are.equal("/books/one.epub", opened)
    end)
    it("stops queued downloads when the account changes", function()
        queue.start(books(), opts)
        stubs.UIManager:drain()
        opts.settings.user_id = "bob"
        pending[1].cb(true, "/books/one.epub")
        stubs.UIManager:drain()
        assert.same({"h1"}, calls)
        assert.is_false(queue.isRunning())
        assert.are.equal(1, #store:listBooks({}))
    end)
    it("records a completed download for its original account after the store closes", function()
        local Store = require("library.librarystore")
        temp_db = os.tmpname()
        store:close()
        store = Store.new{user_id = "bob", db_path = temp_db}
        store:upsertBook{hash = "h1", title = "Bob's copy", cloud_present = 1}
        local bob_before = store:listBooks({})
        store:close()
        store = Store.new{user_id = "alice", db_path = temp_db}
        opts.store = store

        queue.start(books(), opts)
        stubs.UIManager:drain()
        store:close()
        opts.settings.user_id = "bob"
        pending[1].cb(true, "/books/one.epub")
        stubs.UIManager:drain()

        assert.same({"h1"}, calls)
        assert.is_false(queue.isRunning())
        assert.is_nil(opts.store.db)
        store = Store.new{user_id = "alice", db_path = temp_db}
        local alice = store:listBooks({})
        assert.are.equal(1, #alice)
        assert.are.equal("h1", alice[1].hash)
        assert.are.equal(1, alice[1].local_present)
        assert.are.equal("/books/one.epub", alice[1].file_path)
        store:close()
        store = Store.new{user_id = "bob", db_path = temp_db}
        assert.same(bob_before, store:listBooks({}))
    end)
    it("can cancel before the first transfer starts", function()
        queue.start(books(), opts)
        queue.cancel()
        stubs.UIManager:drain()
        assert.are.equal(0, #calls)
        assert.is_false(queue.isRunning())
    end)
    it("does not auto-open a completed book after choosing background", function()
        local opened = false
        opts.on_open = function() opened = true end
        queue.start({books()[1]}, opts)
        stubs.UIManager:drain()
        stubs.UIManager._shown[1].buttons[1][1].callback()
        pending[1].cb(true, "/books/one.epub")
        stubs.UIManager:drain()
        assert.is_false(opened)
    end)
end)
