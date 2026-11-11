# Cadenza

Windows 桌面音樂播放器（Electron + React + TypeScript），核心是會跟著節奏運鏡的「特效歌詞」引擎。兩種介面共用同一套邏輯：經典介面（`src/app/views`）與空間介面（`src/app/space`）。

**動手之前先讀 `.claude/skills/cadenza/SKILL.md`**：分層規則、新增功能的固定流程、測試與發佈流程都在那裡。它是這個專案的開發範式，不是參考資料。

最常用的指令：

```
npx tsc --noEmit -p .     # 型別檢查（必過）
npx vitest run            # 單元測試（必過）
npm run build:app         # 產生 dist-app（截圖測試與桌面版都用它）
```

不可違反的幾件事：

- 嚴格遵守平台授權與 DRM，不使用破解或規避會員限制的方式。
- 不提交任何商業歌詞、音樂檔或使用者資料；測試用自己寫的假資料。
- 介面上的每個字都經過 `docs/COPY.md` 的詞彙表，不直接使用需求描述裡的臨時名稱。
- 回報給使用者一律用繁體中文；程式碼註解用英文。
- 提交訊息與程式碼裡不寫模型名稱。
