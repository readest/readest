-- Loads the bundled LocalSend native lib for this device via LuaJIT FFI.
-- Poll-based ABI: no callbacks ever cross the FFI boundary (LuaJIT forbids
-- calls into Lua from foreign threads).

local M = {}

-- The ls_version() the loaded lib must report; mirrors ABI_VERSION in
-- native/localsend-ffi/src/lib.rs. Bump both together.
local ABI_VERSION = "1"

local CDEF = [[
const char* ls_version(void);
int ls_start(const char* config_json);
char* ls_status(void);
char* ls_poll_event(void);
int ls_accept(const char* session_id);
int ls_decline(const char* session_id);
int ls_stop(void);
void ls_string_free(char* s);
]]

-- Pure mapping so specs can exercise it. Kindle ships soft-float armv7
-- (gnueabi); Kobo (all kobo/kobov4/kobov5) ships hard-float armv7
-- (gnueabihf). The two ABIs are NOT interchangeable: a softfp lib will not
-- dlopen in a hardfloat KOReader process and vice-versa, so each device
-- class is keyed on its own flag rather than the generic Linux/arm pair -
-- no try-load fallback is needed since Kindle and Kobo are distinct,
-- unambiguous device classes. Everything else returns nil.
-- dev = { is_kindle = bool, is_kobo = bool, is_emulator = bool, os = jit.os, arch = jit.arch }
function M.libNameFor(dev)
    if dev.is_kindle and dev.arch == "arm" then
        return "liblocalsend-armv7.so"
    end
    if dev.is_kobo and dev.arch == "arm" then
        return "liblocalsend-armv7hf.so"
    end
    if dev.is_emulator and dev.os == "OSX" and dev.arch == "arm64" then
        return "liblocalsend-arm64.dylib"
    end
    return nil
end

-- Returns the ffi namespace, or nil + reason.
function M.load(plugin_path)
    local ok_ffi, ffi = pcall(require, "ffi")
    if not ok_ffi then return nil, "no ffi" end
    local Device = require("device")
    local name = M.libNameFor({
        is_kindle = Device:isKindle(),
        is_kobo = Device:isKobo(),
        is_emulator = Device:isEmulator(),
        os = jit.os,
        arch = jit.arch,
    })
    if not name then return nil, "unsupported device" end
    local path = plugin_path .. "/libs/" .. name
    pcall(ffi.cdef, CDEF) -- cdef errors on re-declaration; harmless here
    local ok, lib = pcall(ffi.load, path)
    if not ok then return nil, "load failed: " .. tostring(lib) end
    local ok_ver, ver = pcall(function() return ffi.string(lib.ls_version()) end)
    if not ok_ver or ver ~= ABI_VERSION then
        return nil, "ABI mismatch: got " .. tostring(ver) .. ", want " .. ABI_VERSION
    end
    return lib
end

-- Copies a char* returned by the lib into a Lua string and frees it.
function M.takeString(lib, cstr)
    if cstr == nil then return nil end
    local ffi = require("ffi")
    local s = ffi.string(cstr)
    lib.ls_string_free(cstr)
    return s
end

return M
