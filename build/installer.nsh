; Cadenza's own installer pages (electron-builder includes this file; see package.json build.nsis.include).
; Words come from docs/COPY.md, section "安裝程式".
; The pictures are drawn by build/make-installer.cjs from the app's mark.

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "歡迎使用 Cadenza"
  !define MUI_WELCOMEPAGE_TEXT "Cadenza 是你自己的音樂庫：歌曲播放時，歌詞跟著音樂移動。$\r$\n$\r$\n接下來會把 Cadenza 安裝到這台電腦上，只需要一分鐘左右。$\r$\n$\r$\n按「下一步」繼續。"
  !insertmacro MUI_PAGE_WELCOME
  ; (the finish page comes later in the same pass; its words are set here, before it is built)
  !define MUI_FINISHPAGE_TITLE "Cadenza 已安裝"
  !define MUI_FINISHPAGE_TEXT "打開 Cadenza，加入放音樂的資料夾，就可以開始聽。$\r$\n$\r$\n你的音樂庫、歌單和設定都留在這台電腦上。"
  !define MUI_FINISHPAGE_RUN_TEXT "現在打開 Cadenza"
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "移除 Cadenza"
  !define MUI_WELCOMEPAGE_TEXT "接下來會從這台電腦移除 Cadenza。$\r$\n$\r$\n你的音樂檔案不會受影響。$\r$\n$\r$\n按「下一步」繼續。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
