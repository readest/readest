; Readest NSIS Installer Hooks
; Registers/unregisters the thumbnail and preview handler DLL for Windows Explorer

!include "LogicLib.nsh"

; CLSID for Readest Thumbnail Provider
!define CLSID_READEST_THUMBNAIL "{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}"

; IThumbnailProvider Shell Extension Handler GUID
!define SHELL_THUMBNAIL_HANDLER "{e357fccd-a995-4576-b01f-234630154e96}"

; IPreviewHandler Shell Extension Handler GUID
!define SHELL_PREVIEW_HANDLER "{8895b1c6-b41f-4c1c-a562-0d564250836f}"

; prevhost.exe, the surrogate process Explorer hosts preview handlers in
!define APPID_PREVHOST "{6d2b5079-2f0b-48dd-ab7f-97cec514d30b}"

!define PREVIEW_HANDLERS_KEY "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers"

; Each extension has one slot per handler type. Claim it only when it is free or
; already ours, so we never replace another app's handler (e.g. Edge's PDF previewer).
!macro REGISTER_SHELLEX EXT HANDLER
    Push $0
    ReadRegStr $0 HKCR "${EXT}\ShellEx\${HANDLER}" ""
    ${If} $0 == ""
    ${OrIf} $0 == "${CLSID_READEST_THUMBNAIL}"
        WriteRegStr HKCR "${EXT}\ShellEx\${HANDLER}" "" "${CLSID_READEST_THUMBNAIL}"
    ${EndIf}
    Pop $0
!macroend

!macro UNREGISTER_SHELLEX EXT HANDLER
    Push $0
    ReadRegStr $0 HKCR "${EXT}\ShellEx\${HANDLER}" ""
    ${If} $0 == "${CLSID_READEST_THUMBNAIL}"
        DeleteRegKey HKCR "${EXT}\ShellEx\${HANDLER}"
    ${EndIf}
    Pop $0
!macroend

!macro REGISTER_EXT EXT
    !insertmacro REGISTER_SHELLEX "${EXT}" "${SHELL_THUMBNAIL_HANDLER}"
    !insertmacro REGISTER_SHELLEX "${EXT}" "${SHELL_PREVIEW_HANDLER}"
!macroend

!macro UNREGISTER_EXT EXT
    !insertmacro UNREGISTER_SHELLEX "${EXT}" "${SHELL_THUMBNAIL_HANDLER}"
    !insertmacro UNREGISTER_SHELLEX "${EXT}" "${SHELL_PREVIEW_HANDLER}"
!macroend

;------------------------------------------------------------------------------
; NSIS_HOOK_POSTINSTALL - Called after files are installed
;------------------------------------------------------------------------------
!macro NSIS_HOOK_POSTINSTALL
    DetailPrint "Registering Readest Thumbnail Provider..."

    ; Always do manual registration for reliability
    ; regsvr32 may fail silently if DLL can't find dependencies

    ; Register CLSID with full DLL path
    WriteRegStr HKCR "CLSID\${CLSID_READEST_THUMBNAIL}" "" "Readest Thumbnail Provider"
    WriteRegStr HKCR "CLSID\${CLSID_READEST_THUMBNAIL}\InprocServer32" "" "$INSTDIR\readest_thumbnail.dll"
    WriteRegStr HKCR "CLSID\${CLSID_READEST_THUMBNAIL}\InprocServer32" "ThreadingModel" "Apartment"

    ; CRITICAL: Disable process isolation - required because we use IInitializeWithItem, not IInitializeWithStream
    ; Without this, Windows runs the handler in an isolated process that can't load the DLL properly
    WriteRegDWORD HKCR "CLSID\${CLSID_READEST_THUMBNAIL}" "DisableProcessIsolation" 1

    ; The same class is the preview handler, hosted by prevhost.exe
    WriteRegStr HKCR "CLSID\${CLSID_READEST_THUMBNAIL}" "AppID" "${APPID_PREVHOST}"
    WriteRegStr HKCR "CLSID\${CLSID_READEST_THUMBNAIL}" "DisplayName" "Readest Preview Handler"
    WriteRegStr SHCTX "${PREVIEW_HANDLERS_KEY}" "${CLSID_READEST_THUMBNAIL}" "Readest Preview Handler"

    ; Register the handlers directly on each extension (this is what Windows Shell uses)
    !insertmacro REGISTER_EXT ".epub"
    !insertmacro REGISTER_EXT ".mobi"
    !insertmacro REGISTER_EXT ".azw"
    !insertmacro REGISTER_EXT ".azw3"
    !insertmacro REGISTER_EXT ".kf8"
    !insertmacro REGISTER_EXT ".fb2"
    !insertmacro REGISTER_EXT ".cbz"
    !insertmacro REGISTER_EXT ".cbr"
    !insertmacro REGISTER_EXT ".pdf"

    DetailPrint "Thumbnail provider registered successfully."

    ; Refresh shell to apply changes - SHCNE_ASSOCCHANGED
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

;------------------------------------------------------------------------------
; NSIS_HOOK_PREUNINSTALL - Called before files are removed
;------------------------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
    DetailPrint "Unregistering Readest Thumbnail Provider..."

    ; Remove CLSID
    DeleteRegKey HKCR "CLSID\${CLSID_READEST_THUMBNAIL}"
    DeleteRegValue SHCTX "${PREVIEW_HANDLERS_KEY}" "${CLSID_READEST_THUMBNAIL}"

    ; Remove our ShellEx handlers from extensions
    !insertmacro UNREGISTER_EXT ".epub"
    !insertmacro UNREGISTER_EXT ".mobi"
    !insertmacro UNREGISTER_EXT ".azw"
    !insertmacro UNREGISTER_EXT ".azw3"
    !insertmacro UNREGISTER_EXT ".kf8"
    !insertmacro UNREGISTER_EXT ".fb2"
    !insertmacro UNREGISTER_EXT ".cbz"
    !insertmacro UNREGISTER_EXT ".cbr"
    !insertmacro UNREGISTER_EXT ".pdf"

    ; Delete the DLL file
    Delete "$INSTDIR\readest_thumbnail.dll"

    ; Refresh shell
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
