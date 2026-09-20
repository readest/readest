require("spec_helper")
local stubs = require("spec.koreader_stubs")

describe("library sync request lifetime", function()
    local syncbooks, store, settings, opts, pending_pull, pending_push, reply, reconciled, pushes
    before_each(function()
        stubs.reset()
        syncbooks = require("library.syncbooks")
        store = require("library.librarystore").new{user_id = "alice"}
        settings = {user_id = "alice", access_token = "token"}
        reply, pending_pull, pending_push, reconciled, pushes = nil, nil, nil, false, 0
        local client = {
            pullBooks = function(_, _, cb) pending_pull = cb end,
            pushChanges = function(_, _, cb) pending_push = cb; pushes = pushes + 1 end,
        }
        opts = {settings = settings, store = store, sync_auth = {
            withFreshToken = function(_, _, _, cb) cb(true) end,
            getReadestSyncClient = function() return client end,
        }}
    end)
    after_each(function() store:close() end)
    local function completed(ok, message) reply = {ok, message} end
    local function pull()
        syncbooks.syncBooks(opts, "both", completed, function() reconciled = true end)
    end
    it("discards a pull after its store closes without reconciling or pushing", function()
        pull()
        store:close()
        pending_pull(true, {books = {}}, 200)
        assert.same({false, "sync cancelled"}, reply)
        assert.is_false(reconciled)
        assert.are.equal(0, pushes)
    end)
    it("discards a pull after an account change even if its store remains open", function()
        pull()
        settings.user_id = "bob"
        pending_pull(true, {books = {}}, 200)
        assert.same({false, "sync cancelled"}, reply)
        assert.is_nil(store:getLastPulledAt())
        assert.is_false(reconciled)
        assert.are.equal(0, pushes)
    end)
    it("does not start a sync with another account's store", function()
        settings.user_id = "bob"
        pull()
        assert.same({false, "sync cancelled"}, reply)
        assert.is_nil(pending_pull)
        assert.is_false(reconciled)
    end)
    it("discards a pull after logout", function()
        pull()
        settings.access_token = nil
        pending_pull(true, {books = {}}, 200)
        assert.same({false, "sync cancelled"}, reply)
        assert.is_false(reconciled)
    end)
    it("ignores a push acknowledgment after the store closes", function()
        store:upsertBook{hash = "one", title = "One", updated_at = 100}
        syncbooks.pushChangedBooks(opts, completed)
        store:close()
        pending_push(true, {}, 200)
        assert.same({false, "sync cancelled"}, reply)
    end)
    it("does not dispatch after authentication finishes for a different account", function()
        local authenticated
        opts.sync_auth.withFreshToken = function(_, _, _, cb) authenticated = cb end
        pull()
        settings.user_id = "bob"
        authenticated(true)
        assert.same({false, "sync cancelled"}, reply)
        assert.is_nil(pending_pull)
        assert.is_false(reconciled)
    end)
end)
