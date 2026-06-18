-- readingstatus_spec.lua — contract for library/readingstatus.lua
require("spec_helper")
local RS = require("library.readingstatus")

describe("readingstatus mapping", function()
  it("maps Readest -> KOReader", function()
    assert.are.equal("complete", RS.readest_to_ko("finished"))
    assert.are.equal("reading", RS.readest_to_ko("reading"))
    assert.are.equal("abandoned", RS.readest_to_ko("abandoned"))
    assert.is_nil(RS.readest_to_ko("unread"))
    assert.is_nil(RS.readest_to_ko(nil))
  end)

  it("maps KOReader -> Readest", function()
    assert.are.equal("finished", RS.ko_to_readest("complete"))
    assert.are.equal("reading", RS.ko_to_readest("reading"))
    assert.are.equal("abandoned", RS.ko_to_readest("abandoned"))
    assert.is_nil(RS.ko_to_readest(nil))   -- "new"/no status -> no opinion
  end)

  it("parses summary.modified to day ms", function()
    assert.are.equal(os.time({ year = 2026, month = 6, day = 18, hour = 0, min = 0, sec = 0 }) * 1000,
      RS.parse_modified_ms("2026-06-18"))
    assert.is_nil(RS.parse_modified_ms(nil))
    assert.is_nil(RS.parse_modified_ms("garbage"))
  end)
end)

describe("readingstatus reconcile", function()
  it("returns none when both sides already agree", function()
    local r = RS.reconcile({ reading_status = "finished", reading_status_updated_at = 100 },
                           { status = "complete", ts = 50 })
    assert.are.equal("none", r.action)
  end)

  it("applies cloud to KOReader when cloud status is newer", function()
    local r = RS.reconcile({ reading_status = "finished", reading_status_updated_at = 300 },
                           { status = "reading", ts = 100 })
    assert.are.equal("apply_to_ko", r.action)
    assert.are.equal("complete", r.ko_status)
    assert.are.equal("finished", r.readest_status)
    assert.are.equal(300, r.ts)
  end)

  it("applies KOReader to the store when the sidecar status is newer", function()
    local r = RS.reconcile({ reading_status = "reading", reading_status_updated_at = 100 },
                           { status = "complete", ts = 300 })
    assert.are.equal("apply_to_store", r.action)
    assert.are.equal("finished", r.readest_status)
    assert.are.equal(300, r.ts)
  end)

  it("never lets a KOReader 'new'/no-status book override an existing Readest status", function()
    local r = RS.reconcile({ reading_status = "finished", reading_status_updated_at = 10 },
                           { status = nil, ts = 9999 })
    assert.are.equal("apply_to_ko", r.action)  -- push cloud status down, KO has no opinion
  end)

  it("captures a KOReader status when Readest has none", function()
    local r = RS.reconcile({ reading_status = nil, reading_status_updated_at = nil },
                           { status = "abandoned", ts = 5 })
    assert.are.equal("apply_to_store", r.action)
    assert.are.equal("abandoned", r.readest_status)
  end)

  it("converges: after applying the winner to both sides, reconcile is a no-op", function()
    local r = RS.reconcile({ reading_status = "reading", reading_status_updated_at = 100 },
                           { status = "complete", ts = 300 })
    -- emulate equalization: store now holds the winner, sidecar already had it
    local r2 = RS.reconcile({ reading_status = r.readest_status, reading_status_updated_at = r.ts },
                            { status = "complete", ts = 300 })
    assert.are.equal("none", r2.action)
  end)
end)
