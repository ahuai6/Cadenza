# Cadenza 架構

Cadenza 是「詞幕 Lyric Motion」的重構版：個人音樂庫 + 跟隨音樂律動的特效歌詞 + 歌詞影片導出。
本文件說明模組邊界、介面、資料流與時間模型。審計結論見 [AUDIT.md](AUDIT.md)。

## 平台選擇

維持 **Electron + Rust 原生音訊**，不換 Tauri：
- 渲染與導出（Canvas、WebCodecs、字型）需要**確定性**：Electron 自帶固定版本的 Chromium，WebView2 的版本隨系統變動。
- 舊專案的問題不在 Electron，而在引擎內部的耦合（見 AUDIT 的 R1–R8）。
- Hi-Fi 原生播放核心（WASAPI 獨佔、自適應取樣率）已經是獨立的 Rust 程序，介面清楚，直接沿用。

程式語言改為 **TypeScript（strict）**，每個模組都有型別化的公開介面；純邏輯模組（節奏、歌詞、導演）不依賴 DOM，能在 Node 直接單元測試。

## 模組與依賴方向

```
core ──► text ──► lyrics ──┐
  ├────► rhythm ───────────┼──► director ──► render ──► engine ──► app (React)
  ├────► theme ────────────┘                              ▲          ▲
  └────► i18n ────────────────────────────────────────────┼──────────┘
                                         (app 只讀 engine 的 index、core、theme、i18n)
```
依賴只能往下層走，反向的引用一律不允許。`tests/unit/arch.test.ts` 會檢查 `src/` 下每一個 import：
- 每個模組只能引用表中列出的下層模組；
- 介面（`app`）只能經由 `src/engine/index.ts` 取用引擎以下的一切。重做介面時，只需要這個入口。

`lyrics` 只需要節拍來排詞，所以它定義了自己的最小介面 `BeatGrid`（速度、拍長、對齊到格線）。`RhythmMap` 正好符合這個介面，lyrics 因此不必引用 rhythm。

| 模組 | 職責 | 不做的事 |
|------|------|---------|
| `core` | 數學、緩動、解析式彈簧、可種子亂數、事件、極小的狀態容器、顏色 | 任何業務 |
| `rhythm` | **節奏識別 SDK**：從 PCM 算出 `RhythmAnalysis`（可序列化、有版本），`RhythmMap` 查詢介面，`Signals`（脈衝、紙盆彈簧等衍生訊號） | 不知道歌詞或畫面 |
| `lyrics` | LRC/增強型 LRC 解析、歌詞模型、時間正規化（快速單位分群） | 不知道畫面，也不知道節奏引擎（只透過 `BeatGrid`） |
| `text` | 文字系統（`script.ts`：字形叢集、CJK/RTL、斷詞）、字型登錄與載入、以 canvas 量字（不用 DOM） | |
| `i18n` | 六種語言的介面文字 | |
| `theme` | 主題預設、旋鈕、效果參數、樣式正規化（純資料） | |
| `director` | **導演（強前瞻）**：一首歌載入後一次規劃出不可變的 `ScenePlan`；`evaluate(plan, t)` 為純函式 | 不畫任何東西 |
| `render` | 依 `SceneFrame` 繪製；效果外掛登錄表；字形快取；後製 | 不決定時間與位置 |
| `engine` | `Engine` 類別：工作階段（Session）、時鐘、音訊輸出、視圖（環境/特效）、跨 DOM 的共享元素過渡、導出；`configure()`（全部設定的唯一入口）；`index.ts` 是給介面的公開 API | |
| `app` | React 介面（音樂庫、海報牆、播放頁、特效頁、工坊、設定） | 不碰引擎內部，只用 `engine/index.ts` |

## 時間模型（統一時間基準）

- **歌曲時間** `t`：秒，0 為音訊範圍的起點（歌詞時間軸的 0）。
- **時鐘來源** `ClockSource`：Web Audio、Hi-Fi 原生播放器（以 DAC 正在送出的樣本為準）、或無音訊時的自由時鐘。同一時刻只有一個來源是權威。
- 每個 rAF 只取樣一次時鐘，產生唯一的 **`FrameContext`**：
  ```ts
  interface FrameContext {
    t: number; dt: number;          // 歌曲時間與距上一幀
    now: number;                    // 介面時間（ms），只給介面動畫
    rhythm: RhythmSample;           // 此刻的拍相位、脈衝、紙盆彈簧位移、段落能量……
    view: ViewState;                // 環境↔特效 的混合進度、過渡中的共享元素
  }
  ```
  畫布每一層、每個效果、DOM 上的歌詞與進度條、背景脈動，全部讀同一個 `FrameContext`。沒有任何模組自己呼叫 `performance.now()` 來推算音樂時間。

## 節奏 SDK（`src/rhythm`）

```ts
analyze(pcm: Float32Array[], sampleRate: number, opts?): RhythmAnalysis   // 在 Worker 中執行
class RhythmMap {
  constructor(a: RhythmAnalysis, audioStart: number)  // 檔案時間 → 歌曲時間
  beatAt(t): BeatPos                        // { bt 連續拍號, phase 拍內相位, inBar 小節內第幾拍, … }
  timeOf(bt), beatLen(t), snap(t, tol, div) // 拍號 ↔ 時間、對齊格線
  grid(t0, t1, div): number[]               // 拍、半拍、三連音…
  eventsIn(t0, t1, minTier?), eventNear(t, tol?, minTier?), accentAt(t)
  select(opts): RhythmEvent[]               // 依靈敏度選事件（閃光/衝擊/碎玻璃共用）
  level(t), loud(t), spec(t), sounding(t), section(t), build(t)
}
interface RhythmEvent { t; s /* 感知強度，約 0..3 */; tier: 0|1|2 /* 輕/中重/重 */; band: 'low'|'mid'|'high'|'broad';
                        pos: number /* 小節內位置（拍） */; off: boolean /* 反拍 */; push?: number /* 搶拍：所屬的拍 */ }
accentClock(map, t): number                 // 漂浮物共用的時間：重拍時減速、懸停再恢復（羽毛、花瓣、光點…）
```
`accentClock` 是對節奏的一種讀法，所以放在 SDK（`rhythm/accentclock.ts`），每個 map 一張表，預覽和導出一致。新的漂浮效果都必須從這裡取時間，不讀歌曲時間。
演算法（細節見 `src/rhythm/README.md`）：多頻帶對數頻譜通量 → 自適應閾值取峰（拋物線內插的精確時間）→ 節奏圖（tempogram）+ 感知先驗估速 → 動態規劃拍點追蹤 → 小節/拍號/樂句 → 每個起音的**感知顯著度**（音量、頻帶、相對於同位置的意外度、節拍位置）分三層 → 切分/弱起標記 → 自相似新穎度切段落、能量、漸強與爆點。
一拍內可以有多個不同強度的事件；最小間隔取感知融合門檻（約 70 ms）。

### 兩個引擎，一個介面

拍點可以由兩個引擎找出，但輸出永遠是同一份 `RhythmAnalysis`。下游所有模組（`RhythmMap`、`Signals`、Director、特效）只讀這份資料，不必知道是哪個引擎做的。

- **神經網路引擎**（`src/rhythm/neural`，移植自 [Folia](https://github.com/chthollyphile/folia-major)，見 `NOTICE.md`）：
  - **拍點與強拍**：Beat This! 在 WebGPU 上推理，以 30 秒為一塊，不用 DBN，直接取 logit 峰值。
  - **每拍重音**：包括「感受到的拍」（6/8 拍或被數成兩倍速的慢歌會換算回來）、HPSS 律動門檻，以及模型拿不準的段落。
  - **鼓點**：HTDemucs 分出鼓聲後，分底鼓、軍鼓、鈸三類找出鼓點；沒有鼓的歌不給鼓點。
  - **執行方式**：在自己的 Worker 中執行，獨佔一個 GPU device，以 `auto` 切片提交，不搶歌詞繪製的幀。
- **內建引擎**（`analyze.ts` 第 3–5 步）：沒有 WebGPU、沒有模型檔，或使用者在設定中選擇「內建」時使用。
- **接合點**：`analyzeInBackground` 先取得神經網路的讀數（`NeuralRhythm`），再交給 `analyze()`：
  - 第 3–5 步改用它的拍點和逐小節強拍（`bars`）；
  - 第 6 步以鼓點為事件，其他樂器的起音保留在旁邊；沒有律動的小節不出重拍；
  - 每拍重音寫入 `accents`，`Signals.grooveHits` 直接使用。
  - 第 1、2、7 步兩個引擎完全相同。結果帶 `engine` 欄位，版本為 3。
- **模型檔**：`beat_this-wgsl.bin` 和 `htdemucs-wgsl.bin` 都是 MIT 授權，不進 git。`scripts/models.mjs` 按 `src/rhythm/neural/models.json` 的 SHA-256 下載並校驗，打包進 `resources/models`，再由主行程以 `cadenza://model/` 提供（只提供這兩個檔案）。

**衍生訊號**（`Signals`）由事件流以解析式脈衝響應疊加得到，**決定性**（導出與預覽一致）：
- `pulse(t)`：快速起音、指數衰減的脈衝（背景呼吸、光環、頻譜）；
- `cone(t)`：二階阻尼彈簧（低音喇叭紙盆），重拍推出、帶一次微小回彈；鏡頭的「彈動」只讀它；
- `energy(t)`、`sounding(t)`：平滑能量與「是否真的有音樂在響」。

**完整性校驗**（`rhythm/validate.ts` 的 `checkAnalysis(a, duration?)`）：一份分析只有通過校驗才會被存下或使用——版本、拍點遞增且覆蓋全曲、速度與拍距一致（容許 6%，含 ½、2、⅓、3、⅔、1.5 倍的讀法）、事件與小節在範圍內。不通過時先用內建引擎重跑，仍不通過就把歌標記為失敗並記下原因，不會反覆重試。快取裡尚未校驗過的分析，在背景佇列清空後逐一檢查，壞的退回重新分析。

**流式分析**（`rhythm/stream.ts`）：還沒分析過的歌不必等。`analyzeHead` 只用內建引擎讀開頭 30 秒（約 0.3 秒的運算），`extendHead` 再把它延伸到整首：拍點沿開頭後段擬合出的直線（週期與相位取自最多 48 拍的最小平方，不是最後幾拍）繼續，每拍按小節位置補上事件，音量與段落延續。結果標記 `partial`，永遠不存進快取。播放器同時以背景的時間預算跑完整分析（可用神經網路與鼓聲分離），到達後 `Session.stage()` 在旁邊建好新的 map、歌詞時間與規劃，由引擎（`trySwap`）在看不出的時刻換上：特效歌詞正在播放時，等 8 秒內下一個模糊轉場的峰值，換上後舊畫面（此時幾乎全是模糊）在 0.4 秒內溶入新的；沒有轉場可等就以 0.9 秒交叉淡化；特效歌詞不在畫面上時直接換。匯出與工坊一律等完整分析。設定「分析時機」可改回「分析完再播放」。

**資料與音訊的綁定**（`electron/library.cjs` 的 `audioKey`）：分析、響度跟著「聲音」走，不跟著檔案走。鍵是音訊本體的雜湊：略過 ID3v2／v1、APE、FLAC 的 metadata 區塊、MP4 `mdat` 以外的部分、WAV `data` 以外的部分，以及 MPEG 開頭 4 KB（Xing/LAME 資訊幀，只改標籤的工具也會重寫它）。改標籤、改封面、搬移或改名都不會觸發重新分析；真正換了音訊才會。

## 導演（`src/director`）— 強前瞻

`plan(input) → ScenePlan`，輸入是歌詞模型、量好的字、節奏地圖、主題。規劃順序：
1. **時間正規化**（lyrics）：快於感知門檻的連續單位合併為一組。
2. **歌詞框**：先決定哪些詞有框，框的外輪廓計入該組的佔位。
3. **排版**：沿路徑擺字（換行、轉折、回折、新段落），不重疊、相鄰距離有上限。一頁最多 4 行（`PAGE_LINES`），第 5 行出現時最舊的一行退場。
4. **段落轉場**：長間奏 → 模糊轉場；峰值對齊下一段真正的起點（含弱起），時長以拍計、提前開始。
5. **鏡頭**：鏡頭風格是策略（`CameraStyle`）：硬朗切換、平滑滑行、華爾滋。共用的規劃器：
   - 每組字一個取景目標（構圖沿演唱方向留出前方空間，不鎖死中心）；
   - 移動以「位移疊加」構成：`p(t) = p0 + Σ Δᵢ·eᵢ(t)`，相鄰移動自然銜接、速度連續；
   - **約束在規劃中解決**：正在唱的字必須在安全框內（推遲出發或放寬取景）；超過最遠位移閾值就改排模糊轉場；
   - 停留時沿演唱方向緩慢漂移（有上限）；
   - **沒有歌詞的長段落**（前奏、間奏、尾奏）：休息與否看音樂的力度（`driveAt`：歌曲內相對音量，取前後約一秒的平均），不只看有沒有字。音樂在推進時，閒置漂浮減弱、不讓背景休息（`rest`），每拍的震動加強；從歌詞停下起（`wordlessK`，閒置窗口的 `g`）就回應較弱的重拍。音樂安靜時才慢慢休息。
   - **歌詞框完整入鏡**（`fit.ts`）：在鏡頭實際走的取樣路徑上（整首歌，不只有框的段落）檢查每個框（含邊距）和**正在唱的那個字的方框**（`singing()`：取自該字的單位方框，不是詞的中心），有超出安全框的就平移、必要時拉遠（最多到 0.62 倍），拉遠提前開始、延後結束，再以高斯平滑，不跨切鏡；拉遠的上限只由框決定（`kf`），正在唱的字永遠要入鏡；需要拉得更遠的框提前 0.5 秒淡出。對所有鏡頭風格、比例（16:9、16:10、1:1、9:16 都有測試）、橫排直排一視同仁。
6. **效果事件**：閃光、衝擊、碎玻璃、光環……全部由節奏地圖 `select()` 而來。歌詞裡的副歌標記（`#1`/`#2`/`#3`，`cues.ts` 的 `markedEntries`）：標記帶著自己的時間戳（所在音節的逐字時間，或只有標記的時間戳）時是 `exact`，就在那個時間觸發，不吸附到附近的拍；只有整行時間、字的時間是估計的，才吸附到最近的重音。編輯器插入的符號都來自同一份清單（`lyrics/parse.ts` 的 `CUE_SYMBOLS`，介面的 `ui/cues.tsx` 依它生成按鍵與 Alt 快捷鍵），新增一種符號只需在清單與解析中各加一處。**沒有頻率上限**：靈敏度選中的每一個重音都會觸發（同一個擊打不重複算），設定頁附光敏性癲癇提醒。為了讓每幀的成本有界，碎玻璃在下一塊碎裂後半秒內淡出，同時最多約兩塊。
7. **標題**：前奏夠長 → 片頭標題卡；不夠 → 頂部小標題，不影響主歌詞。結尾標題卡。

`evaluate(plan, t, signals) → SceneFrame`：相機姿態（基本路徑 + 動態層：紙盆彈簧、手持漂浮、閒置漂移、衝擊）、每個字的狀態（入場進度、模糊、透明度）、效果參數。純函式，可在任意時間取樣（導出、預熱、測試）。

**投影**：相機姿態 `{x, y, zoom, roll, depth, yaw, pitch}`；字的深度視差以畫面尺度的焦距計算；傾斜是有界的透視（|yaw|,|pitch| ≤ 4°，畫面座標正規化後計算），與字的世界座標無線性耦合。繪製順序由規劃時決定的穩定鍵決定。

## 渲染（`src/render`）

每幀的固定圖層順序：
`backdrop → world-back → lyrics → world-front → foreground → screen → post → handoff`

**效果外掛介面**：
```ts
interface Effect<P> {
  id: string; layer: Layer; label: string;           // label 為 i18n 鍵
  params: ParamSchema<P>;                            // 介面依此自動生成控制項
  plan?(ctx: PlanContext, p: P): unknown;            // 規劃時（一次）：事件、幾何
  prepare?(ctx: PrepareContext, p: P, plan: unknown): void;   // 資源：精靈圖、路徑（依調色盤快取）
  draw(g: CanvasRenderingContext2D, f: RenderFrame, p: P, plan: unknown): void;
}
```
新增效果 = 新增一個檔案並 `register()`；主題只是「背景 + 效果清單 + 參數」，不改核心。

## 引擎（`src/engine`）

```ts
const engine = new Engine(canvas, platform)
const s = await engine.open(spec)          // Session：音訊 + 節奏 + 歌詞 + 樣式 → plan（在閒置時預先建好下一首）
engine.show(s, { transition: 'song' })     // 切歌：兩個 session 同時渲染、交叉過渡
engine.view.to('effect', handoff)          // 環境（播放頁背景）↔ 特效歌詞，共享元素由引擎接手
engine.transport.play() / pause() / seek(t)
engine.export(s, opts)                     // 以獨立的渲染器實例導出，不改動任何共享狀態
configure(engine, { render, gfx, mv, rhythm }) // 宿主（桌面介面、工坊、測試）設定引擎的唯一入口
```
- **MV**：MV 是疊在歌曲自己主題上的一層。比歌曲短時，在結束前淡出（`MvSource.endK`），之後畫面就是這首歌沒有 MV 的樣子——主題照它目前的設定，MV 的裁切也解除；預覽與匯出一致。
- **設定**：各層的設定（`render/gfx.ts` 的畫質模式、`rhythm` 的引擎選擇／鼓聲分離／模型位置、渲染尺寸、MV 外觀）都只從 `configure()` 設定。介面在 `app/engineConfig.ts` 把使用者設定轉成 `EngineConfig`。
- **導出的畫質**：每一幀都在 `withGfx('default', …)` 中同步繪製。即時畫面保持自己的模式，導出期間改設定也不會被還原。
- **神經網路分析排隊**：同一時間只跑一首歌，因為 Worker 中的網路會共用緩衝區。即將播放的歌（`urgent`）優先：
  - 它會插到背景歌曲前面；
  - 若此時正有一首背景歌曲在跑，那次分析會中止，該歌之後再重跑一次，不會退回內建分析。
- **多頁面並行渲染**：播放頁背景就是引擎（環境視圖）；特效視圖在背景預熱（規劃、字形快取、精靈圖）；切歌時新舊兩個 session 同時渲染並交叉過渡。
- **共享元素過渡**：介面量出 DOM 封面與歌詞行的位置交給 `handoff`；引擎從那些位置把封面（旋轉角同步、黑膠從封面下滑出）與歌詞行飛到場景位置；螢幕特效依過渡進度連續變化。返回時反向。
- **模糊轉場不抽搐**：
  - 縮小用逐級減半的平均（`gfx.ts` 的 `downsample`），不是一次縮到很小（一次縮 6 倍以上的雙線性取樣會產生閃爍的鋸齒）；模糊半徑換算到縮小後的尺度，下限 1.5 像素，畫面上永遠看不出低解析度那一層。
  - 轉場前後 0.5 秒內不調整自適應解析度（解析度一變，字形快取也要重建）。
  - 轉場峰值之後的第一幀在轉場開始前就預熱（`lookAhead`），切點後不會因為第一次繪製而卡一下。
- **歌詞寫入標籤**（`electron/library.cjs` 的 `writeTagLyrics`，node-taglib-sharp）：在同一資料夾的隱藏暫存副本上寫入，完成後改名覆蓋原檔（被佔用時重試）；Hi-Fi 輸出時先讓解碼器關閉檔案（`stop`），寫完從原位置重新載入。格式不支援時改存 `.lrc`。設定「歌詞儲存位置」可選標籤或 `.lrc`。

## 介面（`src/app`）

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

- 設計語言：液態玻璃材質（背景模糊 + 飽和 + 內側高光 + 柔和陰影），**連續曲率圓角**（`corner-shape: superellipse()`，圓角半徑使用統一的尺度），以圓角矩形為主。
- 元件樣式用 CSS Modules，類名不會互相覆蓋。
- 介面轉場：每個轉場只有一個進度值，由可反向的彈簧驅動，所有部件都從它派生（不可能卡在半途）。
- 全新圖示集（24 格、1.75 線寬、圓頭）與應用程式圖示。

## 遷移與驗證

分階段：core → rhythm（合成曲目的已知答案測試）→ lyrics/text/theme → director（不變量測試）→ render/effects/engine（渲染測試：繪製順序穩定、剔除正確、虛影對齊、無閃爍）→ 導出 → 介面與桌面端（端到端測試）→ 過渡 → 發佈。
