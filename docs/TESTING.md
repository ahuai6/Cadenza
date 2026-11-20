# 測試

每一套測什麼、怎麼跑、什麼時候要跑、結果怎麼讀。流程規則（每次改動至少跑哪些、回報怎麼寫）在 `.claude/skills/cadenza/SKILL.md` 第 6 節。

## 必過（每次改動）

```
npm run format            # 排版（format:check 必須通過）
npx tsc --noEmit -p .     # 型別
npx vitest run            # 單元測試（約 40 個檔、近 400 項，約 2 分鐘）
npm run build:app         # dist-app：端到端測試與桌面版都用它
```

## 各套測試

| 套 | 指令 | 測什麼 | 何時跑 |
| --- | --- | --- | --- |
| 單元 | `npx vitest run` | 節奏、歌詞（LRC、TTML、分詞、合詞、規則）、導演（排版、鏡頭、轉場、清場、取景、規劃 worker 與頁面一致）、風格資料、設定綱要與字典、指令、佇列、空間的格局資料、Folia 同步的黃金檔、**分層規則**（`arch.test.ts`） | 每次 |
| 渲染 | `npx vite build --mode harness && node tests/render.cjs [名稱…]` | 每種外觀與背景在每個時刻都畫得出畫面、顯示卡歌詞層與畫布一致、距離場字形、剔除不吃掉可見的字、效能、畫質模式與轉場、匯出 MP4 | 改導演、渲染、特效、引擎 |
| 桌面 | `DISPLAY=:99 node tests/desktop.cjs [截圖資料夾]` | 經典介面端到端：音樂庫、播放、佇列、正在播放頁（含背景切換）、特效歌詞與控制列、外觀與風格頁、工坊、設定、匯出、小視窗、桌面歌詞 | 改經典介面、播放 |
| 空間 | `DISPLAY=:99 node tests/space.cjs [截圖資料夾]`（約 5 分鐘） | 各房間、空中歌詞與字幕、進度拖曳、互動距離、設定卡、播放列、收音機、準星選單、30 秒堆積大小（差小於 1.5 MB）、頁面無錯誤；跑完**打開截圖看** | 改空間介面 |
| Hi-Fi | `npm run test:hifi` | Rust 播放核心（模擬 DAC）與桌面整合 | 改 `native/`、`electron/audio.cjs`；需要 Rust 工具鏈 |
| 神經網路 | `node scripts/models.mjs && node tests/neural.cjs` | 真實模型在 WebGPU（SwiftShader）上的端到端 | 改 `src/rhythm/neural` |
| Folia 對照 | 見下 | Cadenza 的移植與 Folia 本身逐格比較 | 改 `src/folia`、跟上游更新 |

`tests/serve.cjs` 是測試共用的靜態伺服器；`tests/fixtures/` 是自己做的假資料（封面、長歌詞、TTML、`gen/` 的合成歌曲）。**不放任何商業歌詞或音樂。**

## 渲染測試的效能門檻（3.5.0 重新校準）

這個環境的瀏覽器以軟體繪圖，比顯示卡慢數倍，而且快慢隨機器而變：以毫秒為門檻時，同一份程式碼在慢的機器上就會失敗。所以 `perf` 先量一段**不含 Cadenza 程式碼的固定畫布工作**（漸層、帶陰影的文字、縮放複製、讀回一個像素）當這台機器的速度，再把每幀的時間換成它的倍數：

- 3.5.0 量到的倍數（三次在 5% 內）：liquid 9.4、gothic 12.5、cover 11。
- 超過基準 25% 才失敗。基準要更新時，在 `tests/render.cjs` 的 `BASE` 改數字並寫明版本與原因。

效能結論只能來自實機；這裡的數字只看「有沒有變慢」。

## Folia 對照

參考頁（`tests/folia-ref/`）在 Folia 的 checkout 裡建置，用真正的 Pixi 8 與 Folia 自己的 React 背景；Cadenza 這邊用 harness（`npx vite build --mode harness`）。參考頁需要的套件照 Folia 的 lockfile 版本另外裝進 checkout 的 `node_modules`（在 checkout 裡直接 `npm install` 會被它的 git 依賴擋住）。

```
node tests/folia-stage-compare.cjs <checkout> <輸出>                                # 舞台：文字、圖形、模糊、濾鏡、遮罩
node tests/folia-compare.cjs <checkout> <輸出> sonnet,tempera 0.5                    # 全曲逐格（靜止）
node tests/folia-compare.cjs <checkout> <輸出> sonnet-beat,tempera-beat 2.1          # 播放中、拍點特效開啟
node tests/folia-bg-compare.cjs <checkout> <輸出>                                   # 五種背景（靜止）＋動態（幾何圖形、莫奈漂移）
```

做法與注意：

- 兩邊的 `Math.random` 換成同一個固定種子（Folia 有幾處細節用真亂數）。每格在全新狀態下畫。
- **拍點對照**：兩邊裝同一份合成拍點清單，在虛擬時鐘（`performance.now` 被換掉）上以每秒 60 步走過時間點前 1.5 秒，再畫那一格。
- **動態背景對照**：Folia 的幾何圖形與莫奈漂移是瀏覽器動畫，暫停後設到同一時刻（`BG.seek`）；幾何圖形的版面由同一個種子產生（`BG.seed`）。參考頁用 1920×1080：Cadenza 把 Folia 的 CSS 像素當成 1080p 頁面的大小。
- 軟體 WebGL 偶爾掉格，腳本會重畫；磁碟額度用完時瀏覽器會直接崩潰，先清空間。

3.5.0 的結果（平均色差，越小越像）：

| 對照 | 結果 |
| --- | --- |
| 五種背景（靜止） | 0.00%–0.14% |
| 通用背景的幾何圖形（1、7、13.5、29、61 秒） | 0.02% |
| 莫奈的漂移（6、17、40 秒） | 0.25%（0.5 秒時 0.44%，是淡入） |
| 商籟，靜止／播放中 | 粗略重合率 95%／95%；拍點反應兩邊逐格一致（開關拍點造成的變化兩邊完全相同） |
| 凝彩，靜止／播放中 | 粗略重合率 98%／99%；剩下的差異來自 Folia 在播放狀態另以牆鐘時間驅動的色塊動畫，不是拍點 |

## 回報

回報時分清楚：「測過且通過」「只改了邏輯、沒有驗證」「這個環境無法驗證（實體顯示卡、聲音、Windows 視窗行為）」。改既有測試的門檻或斷言，在測試裡註明版本與原因。
