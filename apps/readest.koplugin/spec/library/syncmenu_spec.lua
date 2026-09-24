require("spec_helper")
local stubs = require("spec.koreader_stubs")

describe("library sync menus", function()
    before_each(function() stubs.reset() end)

    it("does not expose library push/pull in the reader menu", function()
        local menu = {}
        require("main"):addToMainMenu(menu)
        for _, item in ipairs(menu.readest_sync.sub_item_table) do
            assert.are_not.equal("Push books now", item.text)
            assert.are_not.equal("Pull books now", item.text)
        end
    end)

    it("offers manual sync with auto sync off and closes the dialog first", function()
        local names = { "ui/widget/buttondialog", "ui/widget/pathchooser", "library.libraryviewmenu" }
        local saved = {}
        for _, name in ipairs(names) do saved[name] = package.loaded[name] end
        package.loaded[names[1]] = { new = function(_, o) return o end }
        package.loaded[names[2]] = {}
        package.loaded[names[3]] = nil
        local called = false
        local ok, err = pcall(function()
            require("library.libraryviewmenu").show({
                settings = { auto_sync = false },
                on_sync = function()
                    assert.are.equal(1, #stubs.UIManager._closed)
                    called = true
                end,
            })
            local dialog = stubs.UIManager._shown[1]
            for _, row in ipairs(dialog.buttons) do
                for _, button in ipairs(row) do
                    if button.text == "Sync now" then button.callback() end
                end
            end
            assert.is_true(called)
        end)
        for _, name in ipairs(names) do package.loaded[name] = saved[name] end
        assert.is_true(ok, tostring(err))
    end)
end)
