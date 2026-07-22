require("spec_helper")
local StatusSync = require("library.statussync")
local LibraryStore = require("library.librarystore")

local function fake_deps(summaries, writes)
  return {
    now_ms = function() return 1750000000000 end,
    open_summary = function(path) return summaries[path] end,           -- {status, modified}
    write_status = function(path, ko_status) writes[path] = ko_status end,
  }
end

describe("statussync.reconcileLocalStatuses", function()
  it("applies a newer cloud status down to the sidecar", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h1", title = "T", file_path = "/b1.epub", local_present = 1,
                       reading_status = "finished", reading_status_updated_at = 1770000000000 })
    local summaries = { ["/b1.epub"] = { status = "reading", modified = "2026-01-01" } }
    local writes = {}
    StatusSync.reconcileLocalStatuses(store, fake_deps(summaries, writes))
    assert.are.equal("complete", writes["/b1.epub"])
    store:close()
  end)

  it("captures a newer sidecar status into the store and bumps updated_at", function()
    local RS = require("library.readingstatus")
    local expected_ts = RS.parse_modified_ms("2026-06-18")
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h2", title = "T", file_path = "/b2.epub", local_present = 1,
                       reading_status = "reading", reading_status_updated_at = 100 })
    local summaries = { ["/b2.epub"] = { status = "complete", modified = "2026-06-18" } }
    StatusSync.reconcileLocalStatuses(store, fake_deps(summaries, {}))
    local row = store:_getRowRaw("h2")
    assert.are.equal("finished", row.reading_status)
    -- reading_status_updated_at must equal parse_modified_ms("2026-06-18")
    assert.are.equal(expected_ts, row.reading_status_updated_at)
    -- updated_at must have advanced past the pre-set 100ms value
    assert.is_true(row.updated_at > 100, "updated_at should have advanced past 100")
    store:close()
  end)

  it("skips rows without a local file", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h3", title = "T", uploaded_at = 1, local_present = 0,
                       reading_status = "finished", reading_status_updated_at = 1 })
    local writes = {}
    StatusSync.reconcileLocalStatuses(store, fake_deps({}, writes))
    assert.are.same({}, writes)
    store:close()
  end)

  it("first sync: pushes a bootstrap 'finished' to an opened KO book AND stamps the store", function()
    -- Reported case 1: finished in Readest (never-stamped baseline), opened in
    -- KOReader so its sidecar is the auto 'reading'. Must push complete down and
    -- stamp the store so the book leaves bootstrap.
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h4", title = "T", file_path = "/b4.epub", local_present = 1,
                       reading_status = "finished", reading_status_updated_at = 0 })
    local summaries = { ["/b4.epub"] = { status = "reading", modified = "2026-01-01" } }
    local writes = {}
    StatusSync.reconcileLocalStatuses(store, fake_deps(summaries, writes))
    assert.are.equal("complete", writes["/b4.epub"]) -- pushed down, no downgrade
    local row = store:_getRowRaw("h4")
    assert.are.equal("finished", row.reading_status)
    assert.are.equal(1750000000000, row.reading_status_updated_at) -- stamped with now_ms
    store:close()
  end)

  it("first sync: does not touch a book that is undefined in Readest and only 'reading' in KO (case 2)", function()
    local store = LibraryStore.new({ user_id = "u1", db_path = ":memory:" })
    store:upsertBook({ hash = "h5", title = "T", file_path = "/b5.epub", local_present = 1,
                       reading_status = nil, reading_status_updated_at = 0 })
    local summaries = { ["/b5.epub"] = { status = "reading", modified = "2026-01-01" } }
    local writes = {}
    StatusSync.reconcileLocalStatuses(store, fake_deps(summaries, writes))
    assert.are.same({}, writes)
    local row = store:_getRowRaw("h5")
    assert.is_nil(row.reading_status)
    store:close()
  end)
end)
