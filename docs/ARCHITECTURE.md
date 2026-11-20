# Cadenza 架構

本機音樂庫播放器，主打「特效歌詞」：讀出每首歌的節奏，再依節奏把歌詞排版、運鏡、畫出來。這份是總覽：每個部分做什麼、資料怎麼流、邊界在哪。各部分的規則細節在 `docs/parts/`；它們是由這份文件 3.5.0 之前的內容拆出來的，改程式時改對應的那一份。

| 細節文件 | 管什麼 |
| --- | --- |
| [`parts/rhythm.md`](parts/rhythm.md) | 節奏分析的兩個引擎、`RhythmMap`、衍生訊號、校驗、流式分析、資料綁定 |
| [`parts/lyrics.md`](parts/lyrics.md) | 歌詞來源與格式（LRC、TTML）、逐行／逐字、和聲、翻譯與讀音、分詞與依唱法合詞、規則層 |
| [`parts/director.md`](parts/director.md) | 規劃順序、排版、鏡頭程式、轉場時機、觸發、標題、清場機制 |
| [`parts/render.md`](parts/render.md) | 圖層順序、特效外掛、背景（含 Folia）、轉場的樣子、正在播放頁的背景、顯示卡歌詞層、距離場字形 |
| [`parts/engine.md`](parts/engine.md) | Session 與 Engine、重建層級、背景規劃、MV、匯出、交接 |
| [`parts/app.md`](parts/app.md) | 介面與引擎的合約、指令登記表、設定綱要、外觀與風格頁、正在播放頁 |
| [`FOLIA.md`](FOLIA.md) | Folia 風格與背景怎麼搬進來、怎麼跟上游、怎麼和 Folia 對照 |
| [`SPACE.md`](SPACE.md) | 空間介面的格局、形狀、光、聲音、程式結構 |

## 平台

- **Electron + React + TypeScript（strict）**。渲染與匯出需要確定性：Electron 自帶固定版本的 Chromium（WebView2 隨系統變）。純邏輯模組（節奏、歌詞、導演）不依賴 DOM，能在 Node 直接單元測試。
- **高保真輸出**是獨立的 Rust 程序 `native/cadenza-audio`（WASAPI 獨佔、位元完美、自適應取樣率），主程序以管道與它溝通。
- **神經網路節奏**在桌面版由 ONNX Runtime 在 utility process 執行（`electron/infer*.cjs`；Windows 用 DirectML），沒有時退回瀏覽器 WebGPU，再退回內建的訊號分析。

## 分層

```
core ──► text ──► lyrics ──┐
  ├────► rhythm ───────────┼──► director ──► render ──► engine ──► app（React：views/ 經典、space/ 空間）
  ├────► theme ────────────┤        ▲           ▲
  └────► i18n              └──► folia ──────────┘   （Folia 的風格與背景：在 director 旁、render 之下）
electron（主程序：音樂庫、設定、視窗、Hi-Fi、原生推理）   native（Rust 播放核心）
```

依賴只往下走。`tests/unit/arch.test.ts` 檢查 `src/` 下每一個 import：

- 每個模組只能引用它下層的模組；`lyrics` 用自己的最小介面 `BeatGrid` 讀節拍，不引用 `rhythm`。
- 介面（`app`）只能經由 `src/engine/index.ts` 取用引擎以下的一切（以及 `core`、`theme`、`i18n`）。
- `app` 裡：`views/` 與 `space/` 互不引用；邏輯層（`state.ts`、`bridge.ts`、`playback/`、`actions/`、`commands/`、`settings/`）不引用任何畫面；只有 `bridge.ts` 碰主程序；空間的場景只經過 `space/bind.ts` 讀寫 Cadenza。
- 元件樣式不寫字面的圓角與時長（只用 `styles/tokens.css`）。

## 七個部分怎麼咬合

| 部分 | 做什麼 | 主要位置 | 讀誰、被誰讀 |
| --- | --- | --- | --- |
| 音樂庫與播放 | 掃描資料夾、標籤與封面、歌單與收藏、佇列；一般與高保真輸出、音量平衡 | `electron/`、`native/`、`src/app/playback` | 播放器狀態是唯一的「現在在放什麼」，兩種介面都讀它 |
| 節奏 | 拍點、強拍、重音、鼓點、段落、頻段；存成快取（以音訊本體的雜湊為鍵） | `src/rhythm`、`electron/infer*.cjs` | 唯一的時間來源：導演、特效、正在播放頁、專輯線、Folia、空間的光和聲音 |
| 歌詞 | 解析、分詞、依唱法合詞、翻譯與讀音、線上取得、寫回檔案 | `src/lyrics`、`src/text` | 唯一的文字來源：播放列、正在播放頁、特效歌詞、Folia、空間 |
| 特效歌詞 | 導演規劃（或 Folia 的引擎），渲染器與特效外掛畫出來；可匯出影片 | `src/director`、`src/render`、`src/folia`、`src/engine` | 讀節奏與歌詞；風格與外觀來自 `theme` |
| 正在播放頁 | 封面、逐字上浮的歌詞、等待的三點；背景由引擎畫；與特效歌詞無縫交接 | `views/NowPlaying.tsx`、`ui/NpLyrics.tsx` | 讀歌詞模型、節奏（三點的拍）、引擎的環境視圖 |
| 歌詞工坊 | 校時、分詞、風格調整、匯出 | `views/workshop`、`app/workshop` | 與特效歌詞同一頁「外觀與風格」 |
| 兩種介面 | 經典與空間，共用邏輯、指令登記表、設定綱要 | `src/app` | 見 `parts/app.md`、`SPACE.md` |

**改一處之前，先查它還被誰用。** 例如改節奏的事件選擇，會同時改變特效歌詞的閃光、正在播放頁的三點、專輯線的環、Folia 的拍點特效和空間的燈。

## 時間模型

- **歌曲時間** `t`（秒）：0 是歌詞時間軸的 0。所有動畫以歌曲時間或節拍為準，不以幀數為準。
- **時鐘來源**只有一個是權威：標準輸出（以 `getOutputTimestamp` 平滑成不倒退的時鐘）、高保真輸出（以 DAC 正在送出的樣本為準），或沒有音訊時的自由時鐘。
- 每幀只取樣一次時鐘，得到一個 `RenderFrame`（`render/frame.ts`）；畫布每一層、每個特效、正在播放頁的歌詞與進度、空間的燈都讀同一個時間。沒有模組自己用 `performance.now()` 推算音樂時間。
- 導演的規劃是純函式（`evaluate(plan, t)`），所以預覽、預讀、匯出畫出的同一時刻完全相同。

## 一幀的資料流

```
音訊檔 ──► 節奏分析（worker／原生推理，快取）──► RhythmMap ──┐
歌詞檔 ──► parseLyrics ──► 分詞與合詞 ──► 歌詞模型 ──────────┼──► Session
外觀＋風格（theme/style.ts，每首歌各自綁定）─────────────────┘        │
                                                                    ▼
                         導演 plan（worker）→ ScenePlan   或   Folia 引擎（engine 欄位）
                                                                    │
時鐘 t ──► Engine.frameAt(t) ──► RenderFrame ──► renderer：背景 → 歌詞 → 特效 → 轉場的樣子 → 字幕 → 螢幕特效
```

## 登記表（擴充點）

新增東西是「登記一筆」，不是改核心：

| 要加的 | 登記在 | 介面自動 |
| --- | --- | --- |
| 特效、背景 | `render/effects/registry.ts` 的 `register()` | 依 `params` 產生控制項 |
| 鏡頭程式 | `director/cameras.ts` 的 `registerCamera()` | 鏡頭選單 |
| 轉場的樣子 | `render/transitions.ts` 的 `registerTransition()` | 轉場選單 |
| 風格（動態） | `theme/style.ts` 的 `MOTIONS`（可帶 `engine`） | 風格分頁 |
| 外觀 | `theme/style.ts` 的 `PRESETS` | 外觀分頁 |
| 歌詞引擎（Folia 風格） | `render/engines.ts` | 〈風格名〉的設定 |
| 使用者動作 | `app/commands/` 的 `define()` | 兩種介面的選單 |
| 設定 | `app/settings/schema.ts` | 設定頁欄位、型別、預設值 |
| 分詞規則 | `lyrics/rules.ts` 的 `WORD_RULES` | — |
| 歌詞符號（`#1`、`@N`、`$1`…） | `lyrics/parse.ts` 的 `CUE_SYMBOLS` | 編輯器的按鍵 |

流程與檢查清單在 `.claude/skills/cadenza/SKILL.md` 第 4 節。

## 主程序（`electron/`）

- `main.cjs`：視窗、托盤、協定（`cadenza://` 提供封面、音訊、字體、模型）、媒體鍵、程式自己的設定（`settings.json`，預設值檔 `settings.defaults.json` 由綱要產生）。
- `library.cjs`：掃描、標籤（node-taglib-sharp）、封面、歌單、`audioKey`（略過標籤區塊的音訊雜湊，改標籤不會重新分析）、歌詞寫回標籤（暫存副本再改名）。
- `audio.cjs`：與 Rust 高保真播放核心的管道（頁面只給歌曲 id，看不到路徑）。
- `desk.cjs`：桌面歌詞的獨立視窗。
- `infer.cjs`／`inferHost.cjs`：原生推理的 utility process。
- `preload.cjs`：暴露給頁面的 API；頁面只經過 `src/app/bridge.ts` 使用。新增能力三處都要改：`ipcMain.handle` → `preload.cjs` → `bridge.ts`。

受平台保護的檔案（`.ncm`、`.qmc*`、`.kgm` 等）只列出並標示，絕不解密、不播放。
