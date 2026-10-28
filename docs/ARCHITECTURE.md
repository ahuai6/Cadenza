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
core ──► rhythm ──► director ──► render ──► engine ──► app (React)
  │        ▲           ▲  ▲         ▲          ▲
  └──► lyrics ─────────┘  │         │          │
  └──► text ──────────────┘─────────┘          │
  └──► theme ──────────────────────────────────┘
```
依賴只能由左往右；箭頭反向的引用一律不允許（以 `tests/arch.test.ts` 檢查 import）。

| 模組 | 職責 | 不做的事 |
|------|------|---------|
| `core` | 數學、緩動、解析式彈簧、可種子亂數、事件、極小的狀態容器、顏色 | 任何業務 |
| `rhythm` | **節奏識別 SDK**：從 PCM 算出 `RhythmAnalysis`（可序列化、有版本），`RhythmMap` 查詢介面，`Signals`（脈衝、紙盆彈簧等衍生訊號） | 不知道歌詞或畫面 |
| `lyrics` | LRC/增強型 LRC 解析、歌詞模型、時間正規化（快速單位分群）、斷詞 | 不知道畫面 |
| `text` | 字型登錄與載入、以 canvas 量字（不用 DOM） | |
| `theme` | 主題預設、旋鈕、效果參數、樣式正規化（純資料） | |
| `director` | **導演（強前瞻）**：一首歌載入後一次規劃出不可變的 `ScenePlan`；`evaluate(plan, t)` 為純函式 | 不畫任何東西 |
| `render` | 依 `SceneFrame` 繪製；效果外掛登錄表；字形快取；後製 | 不決定時間與位置 |
| `engine` | `Engine` 類別：工作階段（Session）、時鐘、音訊輸出、視圖（環境/特效）、跨 DOM 的共享元素過渡、導出 | |
| `app` | React 介面（音樂庫、海報牆、播放頁、特效頁、工坊、設定） | 不碰引擎內部 |

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
  beatAt(t): { index, phase, bar, beatInBar }
  grid(t0, t1, division): number[]          // 拍、半拍、三連音…
  events(t0, t1, minTier?): RhythmEvent[]   // 任意時間的節奏事件
  select(sensitivity, opts): RhythmEvent[]  // 依靈敏度選事件（閃光/衝擊/碎玻璃共用）
  energy(t), sounding(t), section(t), build(t)
}
interface RhythmEvent { t; strength; tier: 0|1|2 /* 輕/中重/重 */; band: 'low'|'mid'|'high'|'broad';
                        metric: number /* 小節內位置 */; offbeat: boolean; anticipates?: number }
```
演算法（細節見 `src/rhythm/README.md`）：多頻帶對數頻譜通量 → 自適應閾值取峰（拋物線內插的精確時間）→ 節奏圖（tempogram）+ 感知先驗估速 → 動態規劃拍點追蹤 → 小節/拍號/樂句 → 每個起音的**感知顯著度**（音量、頻帶、相對於同位置的意外度、節拍位置）分三層 → 切分/弱起標記 → 自相似新穎度切段落、能量、漸強與爆點。
一拍內可以有多個不同強度的事件；最小間隔取感知融合門檻（約 70 ms）。

**衍生訊號**（`Signals`）由事件流以解析式脈衝響應疊加得到，**決定性**（導出與預覽一致）：
- `pulse(t)`：快速起音、指數衰減的脈衝（背景呼吸、光環、頻譜）；
- `cone(t)`：二階阻尼彈簧（低音喇叭紙盆），重拍推出、帶一次微小回彈；鏡頭的「彈動」只讀它；
- `energy(t)`、`sounding(t)`：平滑能量與「是否真的有音樂在響」。

## 導演（`src/director`）— 強前瞻

`plan(input) → ScenePlan`，輸入是歌詞模型、量好的字、節奏地圖、主題。規劃順序：
1. **時間正規化**（lyrics）：快於感知門檻的連續單位合併為一組。
2. **歌詞框**：先決定哪些詞有框，框的外輪廓計入該組的佔位。
3. **排版**：沿路徑擺字（換行、轉折、回折、新段落），不重疊、相鄰距離有上限。
4. **段落轉場**：長間奏 → 模糊轉場；峰值對齊下一段真正的起點（含弱起），時長以拍計、提前開始。
5. **鏡頭**：鏡頭風格是策略（`CameraStyle`）：硬朗切換、平滑滑行、華爾滋。共用的規劃器：
   - 每組字一個取景目標（構圖沿演唱方向留出前方空間，不鎖死中心）；
   - 移動以「位移疊加」構成：`p(t) = p0 + Σ Δᵢ·eᵢ(t)`，相鄰移動自然銜接、速度連續；
   - **約束在規劃中解決**：正在唱的字必須在安全框內（推遲出發或放寬取景）；超過最遠位移閾值就改排模糊轉場；
   - 停留時沿演唱方向緩慢漂移（有上限）。
6. **效果事件**：閃光、衝擊、碎玻璃、光環……全部由節奏地圖 `select()` 而來。
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
```
- **多頁面並行渲染**：播放頁背景就是引擎（環境視圖）；特效視圖在背景預熱（規劃、字形快取、精靈圖）；切歌時新舊兩個 session 同時渲染並交叉過渡。
- **共享元素過渡**：介面量出 DOM 封面與歌詞行的位置交給 `handoff`；引擎從那些位置把封面（旋轉角同步、黑膠從封面下滑出）與歌詞行飛到場景位置；螢幕特效依過渡進度連續變化。返回時反向。

## 介面（`src/app`）

- 設計語言：液態玻璃材質（背景模糊 + 飽和 + 內側高光 + 柔和陰影），**連續曲率圓角**（`corner-shape: superellipse()`，圓角半徑使用統一的尺度），以圓角矩形為主。
- 元件樣式用 CSS Modules，類名不會互相覆蓋。
- 介面轉場：每個轉場只有一個進度值，由可反向的彈簧驅動，所有部件都從它派生（不可能卡在半途）。
- 全新圖示集（24 格、1.75 線寬、圓頭）與應用程式圖示。

## 遷移與驗證

分階段：core → rhythm（合成曲目的已知答案測試）→ lyrics/text/theme → director（不變量測試）→ render/effects/engine（渲染測試：繪製順序穩定、剔除正確、虛影對齊、無閃爍）→ 導出 → 介面與桌面端（端到端測試）→ 過渡 → 發佈。
