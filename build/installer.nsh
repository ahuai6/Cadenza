; Cadenza's own installer: one window without the usual frame, drawn edge to edge — a welcome page that also holds the
; install folder, the copying page, and a page to open the app — instead of the stock wizard pages.
; electron-builder includes this file (package.json build.nsis.include) and calls the macros below where its own
; pages would be. The pictures are drawn by build/installer/draw.cjs; the places of the live controls laid over them
; come from the layout.nsh it writes. Words: docs/COPY.md, 安裝程式.

ManifestDPIAware true
; (the PNGs become BMPs while this compiles: NSIS shows nothing else)
!system 'node "${BUILD_RESOURCES_DIR}\installer\bmp.cjs"' = 0
!include "${BUILD_RESOURCES_DIR}\installer\layout.nsh"

; (backslashes: makensis on Windows does not take a path that mixes the two)
!define CZ_ART "${BUILD_RESOURCES_DIR}\installer\out"

; (only for trying the pages under Wine, where the stock "is the app running" check always says yes)
!if "$%CZ_NSIS_TRY%" == "1"
  !macro customCheckAppRunning
  !macroend
!endif

; (the uninstaller keeps the stock pages, with the same evening beside them)
!ifdef BUILD_UNINSTALLER
  !ifdef MUI_UNWELCOMEFINISHPAGE_BITMAP
    !undef MUI_UNWELCOMEFINISHPAGE_BITMAP
  !endif
  !define MUI_UNWELCOMEFINISHPAGE_BITMAP "${CZ_ART}\side-100.bmp"
!endif

!ifndef BUILD_UNINSTALLER
  Var czScale   ; the pictures drawn for this display: 100, 125, 150 or 200
  Var czDpi
  Var czDlg
  Var czPath
  Var czDir     ; a folder chosen on the welcome page (the install-mode step would otherwise reset it)
  Var czFont
  Var czFontS
  Var czFontX
  Var czImg
  Var czImg2
!endif

; a length at 100 % to this display's pixels
!macro czPx OUT V
  IntOp ${OUT} ${V} * $czDpi
  IntOp ${OUT} ${OUT} / 96
!macroend

; a control placed by layout.nsh's name
!macro czPlace HWND NAME
  !insertmacro czPx $R6 ${CZ_${NAME}_X}
  !insertmacro czPx $R7 ${CZ_${NAME}_Y}
  !insertmacro czPx $R8 ${CZ_${NAME}_W}
  !insertmacro czPx $R9 ${CZ_${NAME}_H}
  ; (and above the picture: HWND_TOP)
  System::Call 'user32::SetWindowPos(p ${HWND}, p 0, i $R6, i $R7, i $R8, i $R9, i 0x10)'
!macroend

!macro czHide PARENT ID
  GetDlgItem $1 ${PARENT} ${ID}
  ShowWindow $1 ${SW_HIDE}
!macroend

; per user, never asking (the stock install-mode page): an earlier install for all users stays where it is
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  !endif
!macroend

!macro customWelcomePage
  ; ---- the window: no frame, the size of the pictures, round corners where Windows has them
  Function czFrame
    ${if} $czDpi != ""
      Return
    ${endif}
    System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
    ${if} $0 == "error"
    ${orif} $0 == 0
      System::Call 'user32::GetDC(p 0) p .r1'
      System::Call 'gdi32::GetDeviceCaps(p r1, i 88) i .r0'
      System::Call 'user32::ReleaseDC(p 0, p r1)'
    ${endif}
    StrCpy $czDpi $0
    StrCpy $czScale 100
    ${if} $czDpi > 110
      StrCpy $czScale 125
    ${endif}
    ${if} $czDpi > 130
      StrCpy $czScale 150
    ${endif}
    ${if} $czDpi > 168
      StrCpy $czScale 200
    ${endif}
    InitPluginsDir
    ${if} $czScale == 100
      File "/oname=$PLUGINSDIR\cz-welcome.bmp" "${CZ_ART}\welcome-100.bmp"
      File "/oname=$PLUGINSDIR\cz-progress.bmp" "${CZ_ART}\progress-100.bmp"
      File "/oname=$PLUGINSDIR\cz-finish.bmp" "${CZ_ART}\finish-100.bmp"
      File "/oname=$PLUGINSDIR\cz-install.bmp" "${CZ_ART}\install-100.bmp"
      File "/oname=$PLUGINSDIR\cz-open.bmp" "${CZ_ART}\open-100.bmp"
    ${elseif} $czScale == 125
      File "/oname=$PLUGINSDIR\cz-welcome.bmp" "${CZ_ART}\welcome-125.bmp"
      File "/oname=$PLUGINSDIR\cz-progress.bmp" "${CZ_ART}\progress-125.bmp"
      File "/oname=$PLUGINSDIR\cz-finish.bmp" "${CZ_ART}\finish-125.bmp"
      File "/oname=$PLUGINSDIR\cz-install.bmp" "${CZ_ART}\install-125.bmp"
      File "/oname=$PLUGINSDIR\cz-open.bmp" "${CZ_ART}\open-125.bmp"
    ${elseif} $czScale == 150
      File "/oname=$PLUGINSDIR\cz-welcome.bmp" "${CZ_ART}\welcome-150.bmp"
      File "/oname=$PLUGINSDIR\cz-progress.bmp" "${CZ_ART}\progress-150.bmp"
      File "/oname=$PLUGINSDIR\cz-finish.bmp" "${CZ_ART}\finish-150.bmp"
      File "/oname=$PLUGINSDIR\cz-install.bmp" "${CZ_ART}\install-150.bmp"
      File "/oname=$PLUGINSDIR\cz-open.bmp" "${CZ_ART}\open-150.bmp"
    ${else}
      File "/oname=$PLUGINSDIR\cz-welcome.bmp" "${CZ_ART}\welcome-200.bmp"
      File "/oname=$PLUGINSDIR\cz-progress.bmp" "${CZ_ART}\progress-200.bmp"
      File "/oname=$PLUGINSDIR\cz-finish.bmp" "${CZ_ART}\finish-200.bmp"
      File "/oname=$PLUGINSDIR\cz-install.bmp" "${CZ_ART}\install-200.bmp"
      File "/oname=$PLUGINSDIR\cz-open.bmp" "${CZ_ART}\open-200.bmp"
    ${endif}
    ; (no caption, no sizing border, no sunken edges)
    System::Call 'user32::GetWindowLong(p $HWNDPARENT, i -16) i .r0'
    IntOp $0 $0 & 0xFF3BFFFF
    System::Call 'user32::SetWindowLong(p $HWNDPARENT, i -16, i r0)'
    System::Call 'user32::GetWindowLong(p $HWNDPARENT, i -20) i .r0'
    IntOp $0 $0 & 0xFFFFFCFE
    System::Call 'user32::SetWindowLong(p $HWNDPARENT, i -20, i r0)'
    !insertmacro czPx $1 ${CZ_W}
    !insertmacro czPx $2 ${CZ_H}
    System::Call 'user32::GetSystemMetrics(i 0) i .r3'
    System::Call 'user32::GetSystemMetrics(i 1) i .r4'
    IntOp $3 $3 - $1
    IntOp $3 $3 / 2
    IntOp $4 $4 - $2
    IntOp $4 $4 / 2
    System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r3, i r4, i r1, i r2, i 0x24)'
    System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, *i 2, i 4)'
    ; every page fills the window
    GetDlgItem $0 $HWNDPARENT 1018
    System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i r1, i r2, i 0x14)'
    CreateFont $czFont "Microsoft JhengHei UI" 10 400
    CreateFont $czFontS "Microsoft JhengHei UI" 10 600
    CreateFont $czFontX "Segoe UI" 13 300
  FunctionEnd

  ; the stock wizard's own parts stay hidden on every page (it shows its buttons again as pages change)
  Function czChrome
    Push $1
    !insertmacro czHide $HWNDPARENT 1
    !insertmacro czHide $HWNDPARENT 2
    !insertmacro czHide $HWNDPARENT 3
    !insertmacro czHide $HWNDPARENT 1028
    !insertmacro czHide $HWNDPARENT 1034
    !insertmacro czHide $HWNDPARENT 1035
    !insertmacro czHide $HWNDPARENT 1036
    !insertmacro czHide $HWNDPARENT 1037
    !insertmacro czHide $HWNDPARENT 1038
    !insertmacro czHide $HWNDPARENT 1039
    !insertmacro czHide $HWNDPARENT 1045
    !insertmacro czHide $HWNDPARENT 1256
    Pop $1
  FunctionEnd

  ; a page: the picture behind everything, and the close mark in its corner
  Function czPage
    Pop $1 ; the picture
    nsDialogs::Create 1018
    Pop $czDlg
    SetCtlColors $czDlg "" 0x1C1739
    ${NSD_CreateBitmap} 0 0 100% 100% ""
    Pop $0
    ${NSD_SetStretchedImage} $0 $1 $czImg
    System::Call 'user32::SetWindowPos(p r0, p 1, i 0, i 0, i 0, i 0, i 0x13)'
  FunctionEnd

  Function czCloseMark
    ${NSD_CreateLabel} 0 0 1 1 "×"
    Pop $0
    !insertmacro czPlace $0 close
    SendMessage $0 ${WM_SETFONT} $czFontX 1
    SetCtlColors $0 0xC9C0D8 transparent
    ${NSD_AddStyle} $0 ${SS_CENTER}
    ${NSD_OnClick} $0 czQuit
  FunctionEnd

  Function czQuit
    SendMessage $HWNDPARENT ${WM_COMMAND} 2 0
  FunctionEnd

  Function czNext
    SendMessage $HWNDPARENT 0x408 1 0
  FunctionEnd

  ; ---- welcome: what this is, where it goes, one button
  Function czWelcome
    Call czFrame
    Call czChrome
    Push "$PLUGINSDIR\cz-welcome.bmp"
    Call czPage
    Call czCloseMark
    ${NSD_CreateLabel} 0 0 1 1 "$INSTDIR"
    Pop $czPath
    !insertmacro czPlace $czPath path
    ${NSD_AddStyle} $czPath 0x8000 ; (a long folder loses its middle, not its end)
    SendMessage $czPath ${WM_SETFONT} $czFont 1
    SetCtlColors $czPath 0xF2EAE4 transparent
    ${NSD_CreateLabel} 0 0 1 1 "變更"
    Pop $0
    !insertmacro czPlace $0 change
    SendMessage $0 ${WM_SETFONT} $czFontS 1
    SetCtlColors $0 0xFFB784 transparent
    ${NSD_OnClick} $0 czChange
    ${NSD_CreateBitmap} 0 0 1 1 ""
    Pop $0
    !insertmacro czPlace $0 install
    ${NSD_SetImage} $0 "$PLUGINSDIR\cz-install.bmp" $czImg2
    ${NSD_OnClick} $0 czNext
    ${NSD_CreateLabel} 0 0 1 1 "版本 ${VERSION}"
    Pop $0
    !insertmacro czPlace $0 version
    SendMessage $0 ${WM_SETFONT} $czFont 1
    SetCtlColors $0 0x8E86A6 transparent
    nsDialogs::Show
    ${NSD_FreeImage} $czImg
    ${NSD_FreeImage} $czImg2
  FunctionEnd

  Function czChange
    nsDialogs::SelectFolderDialog "選擇 Cadenza 的安裝位置" $INSTDIR
    Pop $0
    ${if} $0 == "error"
      Return
    ${endif}
    ; (always into a folder of its own, as the stock folder page does)
    StrLen $1 "\${APP_FILENAME}"
    StrCpy $2 $0 "" -$1
    ${if} $2 != "\${APP_FILENAME}"
      StrCpy $0 "$0\${APP_FILENAME}"
    ${endif}
    StrCpy $INSTDIR $0
    StrCpy $czDir $0
    ${NSD_SetText} $czPath $INSTDIR
    ; (a see-through label keeps its old words until what is behind it is drawn again)
    System::Call 'user32::InvalidateRect(p $czDlg, p 0, i 1)'
  FunctionEnd

  Page custom czWelcome
!macroend

!macro customPageAfterChangeDir
  ; (the install-mode step has set the folder again: put back the one chosen on the welcome page)
  Function czApplyDir
    ${if} $czDir != ""
      StrCpy $INSTDIR $czDir
    ${endif}
    Abort
  FunctionEnd
  Page custom czApplyDir

  ; ---- copying: the same picture, a thin bar; on to the last page by itself
  Function czInstShow
    Call czChrome
    SetAutoClose true
    FindWindow $0 "#32770" "" $HWNDPARENT
    !insertmacro czHide $0 1006
    !insertmacro czHide $0 1016
    !insertmacro czHide $0 1027
    !insertmacro czPx $3 ${CZ_W}
    !insertmacro czPx $4 ${CZ_H}
    System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i r3, i r4, i 0x14)'
    System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "", i 0x5000000E, i 0, i 0, i r3, i r4, p r0, p 0, p 0, p 0) p .r1'
    System::Call 'user32::LoadImage(p 0, w "$PLUGINSDIR\cz-progress.bmp", i 0, i r3, i r4, i 0x10) p .r2'
    SendMessage $1 0x172 0 $2
    System::Call 'user32::SetWindowPos(p r1, p 1, i 0, i 0, i 0, i 0, i 0x13)'
    GetDlgItem $1 $0 1004
    System::Call 'uxtheme::SetWindowTheme(p r1, w "", w "")'
    System::Call 'user32::SetWindowLong(p r1, i -20, i 0)'
    System::Call 'user32::GetWindowLong(p r1, i -16) i .r2'
    IntOp $2 $2 & 0xFF7FFFFF
    System::Call 'user32::SetWindowLong(p r1, i -16, i r2)'
    SendMessage $1 0x409 0 0x84B7FF   ; PBM_SETBARCOLOR (#FFB784)
    SendMessage $1 0x2001 0 0x4B3533  ; PBM_SETBKCOLOR (#33354B)
    !insertmacro czPlace $1 bar
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW czInstShow
!macroend

!macro customFinishPage
  ; ---- done: open the app, or just close
  Function czFinish
    Call czChrome
    Push "$PLUGINSDIR\cz-finish.bmp"
    Call czPage
    Call czCloseMark
    ${NSD_CreateBitmap} 0 0 1 1 ""
    Pop $0
    !insertmacro czPlace $0 open
    ${NSD_SetImage} $0 "$PLUGINSDIR\cz-open.bmp" $czImg2
    ${NSD_OnClick} $0 czOpen
    ${NSD_CreateLabel} 0 0 1 1 "完成"
    Pop $0
    !insertmacro czPlace $0 done
    SendMessage $0 ${WM_SETFONT} $czFontS 1
    SetCtlColors $0 0xD8CFE6 transparent
    ${NSD_OnClick} $0 czNext
    nsDialogs::Show
    ${NSD_FreeImage} $czImg
    ${NSD_FreeImage} $czImg2
  FunctionEnd

  Function czOpen
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
    Call czNext
  FunctionEnd

  Page custom czFinish
!macroend

; ---- the uninstaller: the stock pages, in our words
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "移除 Cadenza"
  !define MUI_WELCOMEPAGE_TEXT "接下來會從這台電腦移除 Cadenza。$\r$\n$\r$\n你的音樂檔案不會受影響。$\r$\n$\r$\n按「下一步」繼續。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
