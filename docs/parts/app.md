# 介面（`src/app`）

經典介面（`views/`）與空間介面（`space/`）共用同一套邏輯、指令登記表與設定綱要。總覽在 `docs/ARCHITECTURE.md`，視覺規則在 `docs/DESIGN.md`，空間的設計在 `docs/SPACE.md`。

## 合約與分層

字體選單的名稱預覽是預先烘焙的圖（`src/app/ui/font-previews/`，每種語言一張 WebP 加位置表，`npm run fonts:previews` 重新生成），以遮罩顯示、跟隨文字顏色；打開選單不載入任何字體。

視覺語言見 `docs/DESIGN.md`。所有元件只讀 `styles/tokens.css` 的變數（四級圓角、表面、動態曲線），架構測試會擋下寫死的圓角與時長。共用的互動元件都在 `ui/kit.tsx`：
- `Dropdown`：自繪下拉，取代所有原生 `<select>`；
- `ContextMenu`：右鍵選單，支援二級選單；
- `Turn`：換頁與換區塊時，先淡出舊的、再淡入新的；
- `usePresence`：讓會開關的東西都有離場動畫。

離場中的畫面仍會重繪，因此元件要用傳入的資料，不要假設全域狀態仍在。字體選單在 `ui/fonts.tsx`，介面字體在 `uifont.ts`。特效歌詞的畫面比例（`settings.fxAspect`）由 `playback/player.ts` 的 `setFxAspect` 統一套用到場景、畫面框與匯出。

介面是可以整個替換的一層。它和引擎之間的合約是：
- **只引用** `src/engine/index.ts`、`core`、`theme`、`i18n`（由架構測試把關）。
- **設定**：經由 `app/engineConfig.ts` → `configure()`。
- **視覺參數**：一律用 `src/app/styles/tokens.css` 的設計變數（顏色、圓角、時長、緩動、陰影），元件裡不寫死數值。
- **測試鉤子**：`data-test` 屬性和 `window.__cadenza`（由 `actions/boot.ts` 掛上）。新介面要保留同名的鉤子，桌面端到端測試才能沿用。

介面內部分成兩半，重做時只換第二半：

| 留下的（邏輯） | 內容 |
|---|---|
| `bridge.ts` | 與桌面主行程的型別化介面（音樂庫、設定、視窗、Hi-Fi） |
| `state.ts` | 介面狀態（頁面、圖層、彈窗、音樂庫、設定）的 store |
| `playback/` | 播放器、佇列、Hi-Fi、背景分析、引擎實例（`stage.ts`） |
| `actions/` | 啟動（`boot`）、快捷鍵（`bindKeys`）、換頁（`go`）、改設定（`setSettings`、`setLang`） |
| `engineConfig.ts` | 使用者設定 → `EngineConfig` |
| `layers.ts`、`motion.ts` | 頁面 ⇄ 正在播放 ⇄ 特效歌詞 的圖層與轉場進度（與樣式無關） |
| `workshop/project.ts` | 工坊的專案模型 |

| 換掉的（外觀） | 內容 |
|---|---|
| `views/` | 各頁面元件與其 CSS Modules |
| `ui/` | 元件庫（按鈕、滑桿、選單、圖示…） |
| `styles/` | 設計變數（`tokens.css`）與基底樣式 |

邏輯這一半不得引用 `views/` 或 `ui/`，只有入口 `main.tsx` 例外（架構測試把關）。所以新介面只要呼叫 `actions/`、讀 `state.ts`、掛上 `playback/stage.ts` 的畫布，就能接上整個播放器。

- 設計語言（顏色、字、圓角、動態、積木）見 `docs/DESIGN.md`，數值只在 `styles/tokens.css`。
- 元件樣式用 CSS Modules，類名不會互相覆蓋。
- 介面轉場：每個轉場只有一個進度值，由可反向的彈簧驅動，所有部件都從它派生（不可能卡在半途）。
- 圖示集在 `ui/icons`（24 格、圓頭線條）。

## 功能只定義一次

- **指令登記表**（`app/commands/`）：每個使用者動作（播放、加入佇列、收藏、加入歌單、編輯資訊…）定義一次；經典介面的右鍵選單、空間介面的卡片按鈕與準星選單都從這裡取。
- **設定綱要**（`app/settings/schema.ts`）：每個設定宣告一次；型別、兩邊的預設值、主程序的預設值檔（`npm run gen:settings`）、設定頁的欄位（`<SettingField k=… />`）都由它產生。
- **字典**（`src/i18n/dict.json`）：六種語言，一行 JSON（`{ langs, dict: { 語言: { 鍵: 字 } } }`）。用詞先過 `docs/COPY.md`。

## 外觀與風格頁（`views/panes.tsx` 的 `StylePage`，3.5.0）

特效歌詞的「外觀與風格」與歌詞工坊的「外觀」用同一頁，四個分頁（記得上次開的）：

| 分頁 | 內容 |
| --- | --- |
| 外觀 | 外觀與自己的主題（`ThemePane`）、背景與它的參數（`LookPane`，含 MV）、顏色、字體（`TextPane`） |
| 風格 | 內建風格與我的風格（`MotionPane part="tiles"`） |
| 進階 | 〈風格名〉的設定（Folia 風格）、微調、鏡頭與細項（鏡頭、轉場與轉場的樣子、閃光、歌詞類型、未唱的字、入場與退場、每一個細項旋鈕） |
| 特效 | 特效分組；Folia 風格的畫面處理 |

鏡頭與轉場的選單由登記表列出（`cameraPrograms()`、`transitions()`），新增一種不必改這頁。

## 正在播放頁

`views/NowPlaying.tsx` 與 `ui/NpLyrics.tsx`：封面、逐字上浮的歌詞清單、等待時的三個點（從中心淡入撐開、期間隨拍點亮與收縮、離場提前半拍放大再縮小）。背景由引擎畫（見 `docs/parts/render.md`），設定在正在播放頁的設定選單（`Modals.tsx`）。
