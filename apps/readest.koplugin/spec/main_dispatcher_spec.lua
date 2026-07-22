-- main_dispatcher_spec.lua
-- Tests for the Dispatcher actions the plugin exposes to KOReader's "Taps and
-- gestures" picker.
--
-- Issue #5094: "Full sync all annotations" existed only as a menu entry, so
-- reaching it took several taps and it could not be bound to a gesture. The
-- work it does (fullSyncBookNotes) already shipped — what was missing was the
-- Dispatcher registration that makes it bindable.

require("spec_helper")
local stubs = require("spec.koreader_stubs")

local ReadestSync = require("main")

-- Bare plugin instance: skips init() (menu/meta wiring) so the specs can call
-- the registration hooks directly.
local function makePlugin()
    return setmetatable({
        settings = { access_token = "tok" },
        ui = { document = {} },
    }, { __index = ReadestSync })
end

describe("ReadestSync dispatcher actions", function()
    before_each(function()
        stubs.reset()
    end)

    describe("full annotation sync (issue #5094)", function()
        it("is registered as a gesture-bindable action", function()
            makePlugin():onDispatcherRegisterReaderActions()

            local action = stubs.Dispatcher:find("readest_sync_full_annotations")
            assert.is_not_nil(action)
            assert.are.equal("ReadestSyncFullSyncAnnotations", action.event)
            -- reader=true: fullSyncBookNotes operates on the open document, so
            -- the action would never fire from the FileManager context.
            assert.is_true(action.reader)
        end)

        it("is titled so it is findable in the gesture picker", function()
            makePlugin():onDispatcherRegisterReaderActions()

            -- The picker pools every plugin's actions into one flat list, so a
            -- bare "Full sync all annotations" is ambiguous next to KOSync's.
            local title = stubs.Dispatcher:find("readest_sync_full_annotations").title:lower()
            assert.is_truthy(title:find("readest", 1, true))
            assert.is_truthy(title:find("annotation", 1, true))
        end)

        it("pushes and pulls every annotation when the gesture fires", function()
            local plugin = makePlugin()
            local calls = {}
            plugin.pushBookNotes = function(_, interactive, full)
                table.insert(calls, { dir = "push", interactive = interactive, full = full })
            end
            plugin.pullBookNotes = function(_, interactive, full)
                table.insert(calls, { dir = "pull", interactive = interactive, full = full })
            end

            plugin:onReadestSyncFullSyncAnnotations()

            -- Same contract as the menu entry: a full (not delta) sync, both
            -- directions, push before pull, with interactive feedback.
            assert.are.same({
                { dir = "push", interactive = true, full = true },
                { dir = "pull", interactive = true, full = true },
            }, calls)
        end)
    end)

    it("still registers the existing annotation push/pull actions", function()
        makePlugin():onDispatcherRegisterReaderActions()

        assert.is_not_nil(stubs.Dispatcher:find("readest_sync_push_annotations"))
        assert.is_not_nil(stubs.Dispatcher:find("readest_sync_pull_annotations"))
    end)
end)
