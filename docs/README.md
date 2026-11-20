# Cadenza 文件地圖

給第一次接手的人（或 Agent）：照下面的順序讀，半小時內能動手。每份文件只管一件事；改程式時順手改它對應的文件。

## 先讀（依序）

1. **`/CLAUDE.md`**：專案是什麼、七個部分、最常用的指令、不可違反的幾件事。
2. **[`DIRECTION.md`](DIRECTION.md)**：要變成什麼、走到哪、接下來做什麼、使用者已經決定過的事（不要再問、不要改回）。
3. **`.claude/skills/cadenza/SKILL.md`**：開發範式——分層規則、新增東西的固定流程、程式碼規範、測試與發佈流程。**它是規則，不是參考資料。**
4. **[`ARCHITECTURE.md`](ARCHITECTURE.md)**：模組、資料流、時間模型、登記表（擴充點）。

## 動手時查

| 要做的事 | 讀 |
| --- | --- |
| 改節奏分析 | [`parts/rhythm.md`](parts/rhythm.md) |
| 改歌詞解析、分詞、翻譯與讀音 | [`parts/lyrics.md`](parts/lyrics.md) |
| 改排版、鏡頭、轉場時機、清場 | [`parts/director.md`](parts/director.md) |
| 改畫法、特效、背景、轉場的樣子 | [`parts/render.md`](parts/render.md) |
| 改 Session、重建、匯出、交接 | [`parts/engine.md`](parts/engine.md) |
| 改介面（經典）、設定頁、指令 | [`parts/app.md`](parts/app.md)、[`DESIGN.md`](DESIGN.md) |
| 改空間介面 | [`SPACE.md`](SPACE.md) |
| 搬 Folia 的東西、跟上游更新 | [`FOLIA.md`](FOLIA.md) |
| 風格、外觀、旋鈕的結構 | [`STYLE-SYSTEM.md`](STYLE-SYSTEM.md) |
| 介面上的任何一個字 | [`COPY.md`](COPY.md)（詞彙表；先查再用，沒有就先加） |
| 跑測試、看對照數字 | [`TESTING.md`](TESTING.md) |
| 發佈、依賴、資料相容、環境的坑、已知的債 | [`MAINTENANCE.md`](MAINTENANCE.md) |
| 每一版改了什麼（寫給使用者） | [`RELEASE.md`](RELEASE.md) |

## 其他

- [`design/`](design/)：設計原型的原始碼（方向 B「書頁」；說明在 `DESIGN.md` 第 9 節）。
- [`history/`](history/)：舊的審查（2.9.2）與需求核對（2.22.1），只作紀錄，不代表現況。
- `NOTICE.md`（根目錄）：第三方來源與授權。

## 文件的規則

- 繁體中文；程式碼、識別字、路徑照原樣。
- 寫「現況」與「為什麼」，不寫流水帳；流水帳在 `RELEASE.md`。
- 文件與程式不一致時，以程式為準並立刻改文件；設計規則（`DESIGN.md`）例外：先改文件再改程式。
- 新增一份文件就在這裡加一列。
