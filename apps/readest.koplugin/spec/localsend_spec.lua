require("spec_helper")

describe("localsend_ffi.libNameFor", function()
    local FFIMod = require("library.localsend_ffi")

    it("picks the softfp .so on Kindle arm", function()
        assert.equals("liblocalsend-armv7.so",
            FFIMod.libNameFor({ is_kindle = true, os = "Linux", arch = "arm" }))
    end)

    it("picks the arm64 dylib on the macOS emulator", function()
        assert.equals("liblocalsend-arm64.dylib",
            FFIMod.libNameFor({ is_emulator = true, os = "OSX", arch = "arm64" }))
    end)

    it("refuses non-Kindle linux arm devices (Kobo is hard-float)", function()
        assert.is_nil(FFIMod.libNameFor({ os = "Linux", arch = "arm" }))
    end)

    it("refuses other arches", function()
        assert.is_nil(FFIMod.libNameFor({ is_kindle = true, os = "Linux", arch = "x64" }))
        assert.is_nil(FFIMod.libNameFor({ is_emulator = true, os = "Linux", arch = "arm64" }))
    end)
end)
