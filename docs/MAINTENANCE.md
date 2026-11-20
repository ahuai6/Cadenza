# 維護

發佈、跟上游、依賴、資料與快取、開發環境的坑。寫給接手維護的人（或 Agent）。

## 發佈

1. 版本號改 `package.json` 與 `package-lock.json`（兩處的 `version`）。
2. `docs/RELEASE.md` 最上面加一段 `## Cadenza x.y.z`：寫給使用者看，改了什麼、為什麼，不寫實作細節。發佈頁的說明就是這一段（工作流程只取這個版本自己的那一段）。
3. 跑完 `docs/TESTING.md` 的必過項目，以及改到的部分對應的測試。
4. 提交，推到 `space-mode`（觸發 `preview` 工作流程：在 Windows 上建置，產物留在那次執行的 Artifacts，不發佈）。
5. 快轉推到 `main`：`git push origin space-mode:main`。`release` 工作流程在 Windows 上跑型別、單元測試、建置、下載模型、編譯 Rust 播放核心、打包，然後建立 `vX.Y.Z` 發佈（安裝檔、blockmap、免安裝版）。同一個版本已經有發佈時會略過，所以**沒改版本號的推送不會重新發佈**。
6. 等工作流程完成，把發佈頁連結回報給使用者。

查狀態（這個環境的 GitHub GraphQL 被擋，一律用 REST）：

```
gh api repos/ahuai6/Cadenza/actions/runs --jq '.workflow_runs[] | select(.name=="release") | [.id,.status,.conclusion] | @tsv' | head -3
gh api repos/ahuai6/Cadenza/releases/latest --jq '.tag_name+" "+(.assets|map(.name)|join(","))'
```

推送失敗（網路）時以指數退避重試，最多四次。提交訊息結尾帶這個專案要求的署名行；**提交訊息與程式碼裡不寫模型名稱**。`release-notes` 工作流程只在要重寫舊版本的說明時手動執行。

## 跟上 Folia 上游

全部步驟在 `docs/FOLIA.md`。要點：

- 只改 `src/folia/upstream.json`（commit、要搬的檔案、要抽出的宣告、shim、修補），跑 `node scripts/folia-sync.mjs <checkout>`；`src/folia/vendor/` 是產生的，**不手改**。
- 同步腳本遇到未對應的 import、找不到的宣告、不再吻合的修補會失敗並列出來。
- 更新後跑 `FOLIA_UPSTREAM=<checkout> npx vitest run tests/unit/folia.test.ts`，再跑 `docs/TESTING.md` 的 Folia 對照，把數字更新到該文件的表。

## 依賴

- 一律跟最新穩定版，精確鎖定（`package.json` 不用 `^`，`Cargo.toml` 用 `=`）；升級是一次明確的提交並跑完全部測試。上游改 API 就遷移，不留相容墊片。例外：`@types/node` 跟 Electron 內建的 Node 主版本。
- 神經網路模型不進 git：`scripts/models.mjs` 依 `src/rhythm/neural/models.json` 的 SHA-256 下載並校驗；桌面版的 ONNX 模型由使用者在設定裡下載。
- 字體全部 SIL OFL 1.1，`npm run build:app` 時由 `scripts/fonts.mjs` 複製進 `dist-app/fonts`；收錄表用 `npm run fonts:coverage` 重烤，選單預覽圖用 `npm run fonts:previews`。
- 設定綱要改了要跑 `npm run gen:settings`（單元測試會檢查預設值檔是否過期）。

## 資料、快取與相容

- 節奏分析與響度以**音訊本體的雜湊**為鍵（`electron/library.cjs` 的 `audioKey`），改標籤、改名、搬移都不會重新分析。分析的格式有版本（`RHYTHM_VERSION`）；改了分析的輸出就提高版本，舊快取會被當成過期重新分析。
- 每首歌的風格與外觀存在使用者資料裡；`theme/style.ts` 的正規化會把舊格式轉成新格式（例如 3.5.0 起鏡頭 id 是字串、新增 `transFx`）。**新增欄位一律可省略、有預設值**，不要讓舊資料讀不進來。
- 「我的風格」（`app/motions.ts`）存的是 `motionPart` 的欄位；新增屬於動態的欄位時，也要加進 `motionPart` 與 `withSavedMotion`。
- 使用者可在設定裡「清除暫存資料」與「清除所有資料」；兩者的說明不寫「快取」（見 `COPY.md`）。

## 開發環境（雲端容器）的坑

- **沒有顯示卡**：瀏覽器用 SwiftShader 軟體繪圖。效能只能比相對變化；顯示卡情境偶爾遺失（對照腳本會重畫）。
- **端到端測試要 X**：`Xvfb :99 -screen 0 1920x1080x24 &`，再以 `DISPLAY=:99` 執行。
- **磁碟額度**：寫滿時瀏覽器會直接崩潰、建置失敗；`df` 的數字不可信。刪掉不需要的大檔（舊的 `release/`、對照截圖、npm 快取）就能恢復。
- **Folia checkout** 的 `node_modules` 不能在裡面 `npm install`（git 依賴會失敗並清空既有的套件）；照它的 lockfile 版本另外裝好再放進去。
- 長時間的測試放背景跑並把輸出寫到檔案；工作程序重啟會中斷它們，重跑即可。
- 只能在 Windows 實機確認的：Hi-Fi 獨佔輸出、DirectML 推理、視窗與托盤行為、聲音。回報時明說沒有驗證。

## 已知的債

- `src/app/space/world.ts` 仍然很大、沒有完整型別；改它之前先看 `SKILL.md` 第 3 節的結構，照將來的邊界寫。
- 主程序能力要改三處（`ipcMain.handle`、`preload.cjs`、`bridge.ts`），還沒有由一份契約產生。
- 播放控制（上一首、循環方式）與快捷鍵還沒進指令登記表。
- 舊的審查與核對（`docs/history/`）只作紀錄，不代表現況。
