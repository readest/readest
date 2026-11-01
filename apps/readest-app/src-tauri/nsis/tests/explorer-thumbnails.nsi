; Run with makensis, then execute under Windows or an isolated Wine prefix.
; Tests the actual installer hooks, not a copy of their registration logic.
Unicode true
Target amd64-unicode
Name "Readest Explorer registration tests"
OutFile "explorer-thumbnails-test.exe"
RequestExecutionLevel user
SilentInstall silent
!include "../installer-hooks.nsh"

!macro ASSERT_VALUE ROOT KEY NAME EXPECTED MESSAGE
    ReadRegStr $9 ${ROOT} "${KEY}" "${NAME}"
    ${If} $9 != "${EXPECTED}"
        FileWrite $8 "FAIL: ${MESSAGE}: got '$9'$\r$\n"
        FileClose $8
        SetErrorLevel 1
        Quit
    ${EndIf}
!macroend

!macro CHECK_EXTENSION EXT
    !insertmacro ASSERT_VALUE HKCR "${EXT}\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "" "${EXT}: thumbnails must be off by default"
    !insertmacro ASSERT_VALUE HKCR "${EXT}\ShellEx\${SHELL_PREVIEW_HANDLER}" "" "${CLSID_READEST_THUMBNAIL}" "${EXT}: previews must remain registered"
!macroend

Section
    SetRegView 64
    SetShellVarContext current
    StrCpy $INSTDIR "$TEMP\readest-explorer-registration-test"
    FileOpen $8 "$EXEDIR\explorer-thumbnails-test.log" w
    DeleteRegValue HKCU "Software\Readest" "ExplorerThumbnails"

    ; A provider registered under a ProgID rather than directly on the extension.
    WriteRegStr HKCR ".epub" "" "Other.Epub"
    WriteRegStr HKCR "Other.Epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "other-provider"
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro CHECK_EXTENSION ".epub"
    !insertmacro CHECK_EXTENSION ".mobi"
    !insertmacro CHECK_EXTENSION ".azw"
    !insertmacro CHECK_EXTENSION ".azw3"
    !insertmacro CHECK_EXTENSION ".kf8"
    !insertmacro CHECK_EXTENSION ".fb2"
    !insertmacro CHECK_EXTENSION ".cbz"
    !insertmacro CHECK_EXTENSION ".cbr"
    !insertmacro CHECK_EXTENSION ".pdf"
    !insertmacro ASSERT_VALUE HKCR "Other.Epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "other-provider" "ProgID provider preserved"

    FileWrite $8 "PASS: fresh install$\r$\n"
    ; Upgrade: remove only legacy Readest registrations, in either install scope.
    WriteRegStr HKCR ".epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "${CLSID_READEST_THUMBNAIL}"
    WriteRegStr HKCR ".pdf\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "third-party-thumbnail"
    WriteRegStr HKCR ".pdf\ShellEx\${SHELL_PREVIEW_HANDLER}" "" "third-party-preview"
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro CHECK_EXTENSION ".epub"
    !insertmacro ASSERT_VALUE HKCR ".pdf\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "third-party-thumbnail" "third-party thumbnail preserved on upgrade"
    !insertmacro ASSERT_VALUE HKCR ".pdf\ShellEx\${SHELL_PREVIEW_HANDLER}" "" "third-party-preview" "third-party preview preserved on upgrade"
    SetShellVarContext all
    WriteRegStr HKLM "Software\Classes\.mobi\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "${CLSID_READEST_THUMBNAIL}"
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro ASSERT_VALUE HKLM "Software\Classes\.mobi\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "" "machine legacy registration removed"

    FileWrite $8 "PASS: upgrade$\r$\n"
    ; Explicit preference survives reinstall and never overwrites another handler.
    WriteRegDWORD HKCU "Software\Readest" "ExplorerThumbnails" 1
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro ASSERT_VALUE HKCU "Software\Classes\.epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "${CLSID_READEST_THUMBNAIL}" "opt-in enables user thumbnails"
    !insertmacro ASSERT_VALUE HKCR ".pdf\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "third-party-thumbnail" "opt-in preserves another provider"
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro ASSERT_VALUE HKCU "Software\Classes\.epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "${CLSID_READEST_THUMBNAIL}" "opt-in survives reinstall"

    ; Disable persists across updates, including removal of per-user opt-in slots.
    WriteRegDWORD HKCU "Software\Readest" "ExplorerThumbnails" 0
    ; An old machine registration can be hidden underneath the per-user opt-in.
    WriteRegStr HKLM "Software\Classes\.epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "${CLSID_READEST_THUMBNAIL}"
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro ASSERT_VALUE HKLM "Software\Classes\.epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "" "upgrade removes hidden legacy machine slot"
    !insertmacro CHECK_EXTENSION ".epub"
    !insertmacro ASSERT_VALUE HKCR ".pdf\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "third-party-thumbnail" "opt-out preserves another provider"

    ; Uninstall also removes an opted-in per-user slot for a machine install.
    WriteRegDWORD HKCU "Software\Readest" "ExplorerThumbnails" 1
    !insertmacro NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
    !insertmacro ASSERT_VALUE HKCU "Software\Classes\.epub\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "" "uninstall removes opted-in thumbnails"
    !insertmacro ASSERT_VALUE HKCR ".epub\ShellEx\${SHELL_PREVIEW_HANDLER}" "" "" "uninstall removes own preview"
    !insertmacro ASSERT_VALUE HKCR ".pdf\ShellEx\${SHELL_THUMBNAIL_HANDLER}" "" "third-party-thumbnail" "uninstall preserves third-party thumbnail"
    !insertmacro ASSERT_VALUE HKCR ".pdf\ShellEx\${SHELL_PREVIEW_HANDLER}" "" "third-party-preview" "uninstall preserves third-party preview"
    FileWrite $8 "PASS: default off, upgrade migration, both scopes, opt-in, reinstall, opt-out, uninstall, third-party handlers$\r$\n"
    FileClose $8
SectionEnd
