---
name: cadenza
description: Cadenza 專案的開發範式：分層與依賴規則、新增功能／設定／特效／空間物件的固定流程、測試與發佈流程、介面文案與設計語言的規則。在這個專案裡寫任何程式碼、文案或設計之前載入。
---

# Cadenza 開發範式

> 狀態：第一版（3.0.3）。標「現況」的是今天程式碼裡成立的事；標「目標」的是階段 1 重構要達成、之後必須遵守的事。重構每完成一項，就把那一項從「目標」改成「現況」。任務排程在 `docs/ROADMAP.md`。

## 1. 這個專案是什麼

一個本機音樂庫播放器。它和一般播放器的差別只有一件事：**歌詞是會動的畫面**。節奏引擎讀出拍點與重音，導演依此排版、運鏡，渲染器把它畫出來。其他一切（音樂庫、播放、兩種介面）都是為了把這件事送到使用者面前。

做任何決定時的優先順序：

1. 播放不中斷、不走音、不洩漏記憶體。
2. 畫面跟音樂是同一件事（任何動態都應該能回答「它跟著音樂的什麼在動」）。
3. 介面安靜、成熟：技術細節不出現在主要畫面上。
4. 程式碼讓下一個人看得懂、接得上。

## 2. 分層（現況，由 `tests/unit/arch.test.ts` 強制）

```
core      數學、顏色、亂數、事件。不依賴任何東西。
rhythm    節奏分析與 RhythmMap。             ← core
lyrics    歌詞解析與模型。                    ← core, text
text      字體、文字量測、分詞。
theme     風格資料（外觀、動態、旋鈕）。純資料。
director  排版、運鏡、轉場的規劃（純函式，可在 worker 跑）。
render    把規劃畫出來；特效是登記在 registry 的外掛。
engine    Session（一首歌的一切）＋ Engine（時鐘、畫布、輸出）。對外只有 engine/index.ts。
app       介面。只能引用 engine/index.ts、core、theme、i18n。
  ├ state.ts / bridge.ts / playback / actions   邏輯（兩種介面共用）
  ├ ui/        兩種介面共用的元件
  ├ views/     經典介面
  └ space/     空間介面
electron  主程序：音樂庫、設定、視窗、Hi-Fi 輸出、原生推理。
native    Rust 的 Hi-Fi 播放核心。
```

規則：

- `views/` 與 `space/` 互不引用。兩邊都要用的東西放 `ui/`（元件）或邏輯層。
- 邏輯層不引用任何介面。
- 介面不直接碰 `electron`：只經過 `bridge.ts`。
- 空間介面的場景只經過 `space/bind.ts` 讀寫 Cadenza（它是唯一的門）。

## 3. 功能只定義一次（目標）

現況的問題：同一個功能在經典與空間各寫一份（佇列、歌詞列表、專輯展開、設定頁）。之後一律照下面做。

**指令登記表 `src/app/commands/`**：每個使用者動作定義一次（名稱、圖示、何時適用、做什麼）。

```ts
// commands/library.ts
define({
  id: 'track.favorite',
  on: 'track',                 // 作用對象：track（一首歌）、tracks（一組歌）、playlist
  section: 'collect',          // play / collect / make / remove；選單在不同段之間畫線
  icon: 'heart',
  label: (t) => tx(isFav(t.track.id) ? 's.unfav' : 's.fav'),
  when: (t, host) => true,     // 不適用就不出現
  run: (t, host) => Lib?.favorite(t.track.id, !isFav(t.track.id)),
});
```

畫面元件只做兩件事：`menuFor(target)` 取得選單，`run('track.favorite', target)` 執行。不在 `onClick` 裡重寫邏輯、名稱或提示。需要介面配合的動作（問一個名字、開標籤編輯器）透過 `host`：每個介面啟動時用 `setHost` 說自己能做什麼，做不到的指令在那個介面自動不出現。

現況：歌曲、一組歌、歌單的指令已登記；經典介面的右鍵選單與空間介面的卡片按鈕都從登記表取。還沒接上的：播放控制（上一首、循環方式）、快捷鍵、空間的準星選單（第 4 階段第 22 項）。**新增一個歌曲庫動作：在 `commands/library.ts` 加一個 `define`，兩種介面的選單就都有了。**

**設定綱要 `src/app/settings/schema.ts`**：每個設定宣告一次（鍵、預設值、型別、分組、是否進階、作用範圍）。主程序的預設值、`Settings` 型別、兩種介面的設定頁都由它產生。`advanced: true` 的設定只在「進階」裡出現。

現況：`Settings` 型別、介面的預設值、主程序的預設值（`electron/settings.defaults.json`，由 `npm run gen:settings` 產生，單元測試會檢查是否過期）已由綱要產生。**新增設定只做兩件事：在綱要加一項，跑 `npm run gen:settings`。** 設定頁仍是手寫，第 3 階段重做介面時改由綱要產生。

**空間的場景是資料 `src/app/space/`**：

```
scene/      場景描述：房間、物件、光源、可站立區域（純資料＋建造函式）
render/     後製：墨線、光束、曝光與霧、介面玻璃（現況：已拆出，`render/passes.ts`）
systems/    input、audio、camera、lyrics、interact —— 各自一個檔，有型別（現況：`systems/audio.ts`、`systems/lyrics.ts` 已拆出；鏡頭在 `rigs/`：`walk.ts` 自由行走、`shots.ts` 定點鏡位，場景只讀取目前控制器的姿態）
entities/   可互動物件：統一介面 { hover, use, hold?, sound? }
rigs/       鏡頭控制器：walk（自由行走）、director（固定視角／自動運鏡）
```

拆出的模組不認識建築：需要的東西（場景、鏡頭、聲源、聲音怎麼穿過門）在建立時交給它。這是之後換場景、加收音機與多聲道的前提。

新增一個場景＝新增一份場景描述；新增一個可拿起的物件＝實作 entity 介面並登記。不允許再往單一閉包裡加東西。

## 4. 新增東西的固定流程

**新增一個功能**

1. 它是不是一個「動作」？是 → 寫成指令。它需要記住使用者的選擇嗎？是 → 加進設定綱要。
2. 邏輯寫在邏輯層（`playback/`、`actions/`、或主程序），有單元測試。
3. 經典與空間各自接上（多半只是把指令放到合適的位置）。兩邊都要能用到，除非這個功能本質上只屬於一邊。
4. 文案：先查 `docs/COPY.md` 的詞彙表；沒有的詞先加進詞彙表再用。六種語言一起補。
5. 測試（見第 6 節），然後更新 `docs/RELEASE.md`。

**新增一個特效**（現況）：在 `src/render/effects/` 新增檔案並 `register({ id, label, layer, kind, z, params, draw })`；參數由綱要宣告，介面自動生成控制項。不改渲染器本身。

**新增一種風格（動態）**（現況）：在 `theme/style.ts` 的 `MOTIONS` 加一筆；需要的話在 `director/recommend.ts` 加推薦條件。

**新增一種外觀**（現況）：在 `PRESETS` 加一筆。顏色預設取自封面（`render/palette.ts`）。

**新增主程序能力**：`electron/*.cjs` 加 `ipcMain.handle` → `preload.cjs` 暴露 → `bridge.ts` 加型別。三處缺一不可（目標：由一份契約產生）。

## 5. 程式碼規範

現況的債：`space/world.ts` 沒有型別檢查、仍是單一閉包；許多函式過長、區域變數名過短（全專案在 3.0.3 之後做過一次純格式化，但只改了排版，沒有改結構）。這不是風格，是債，不要模仿。

新寫與改到的程式碼：

- 格式由 Prettier 決定（行寬 120，設定在 `.prettierrc.json`）：提交前跑 `npm run format`，`npm run format:check` 必須通過。不手動排版、不為了省行數把敘述擠在一行。
- 不使用 `@ts-nocheck`、`any`（確實需要時用 `unknown` 加收窄）。
- 註解寫「為什麼」和「不變量」，英文，放在它說明的那一行的上一行。**不要把註解接在程式碼同一行後面再接程式碼**——曾有一行快取檢查被行內註解吃掉，造成每幀洩漏。
- 每幀執行的路徑不配置物件（重用暫存向量）、不查 DOM 版面、不做射線檢測（需要時節流到每秒幾次）。
- 任何「建立」都要有對應的「釋放」：貼圖、材質、幾何、事件監聽、計時器、音訊節點。長時間執行的東西加上限（LRU）。
- 數值有單位與來源：魔術數字抽成具名常數並註明意義（秒、公尺、NDC…）。
- 動態用彈簧或有明確曲線的補間，不用線性、不用寫死的 `setTimeout` 串。
- 時間一律以歌曲時間或節拍為準，不以幀數為準。

## 6. 測試流程

每次改動至少：

```
npm run format
npx tsc --noEmit -p .
npx vitest run
npm run build:app
```

依改到的地方加做：

| 改到 | 加做 |
|---|---|
| 導演、渲染 | `npm run test:render`（對照畫面） |
| 經典介面 | `npm run test:desktop` |
| 空間介面 | `npm run test:space <截圖資料夾>`（約 5 分鐘），跑完**打開截圖看** |
| 主程序、Hi-Fi | 只能在 Windows 實機確認，回報時明說 |

空間測試（`tests/space.cjs`）的做法：用 Playwright＋SwiftShader 開 `dist-app/index.html`，注入假的 `window.cadenzaDesktop` 與 `cadenzaLib`，用 `window.__cad` 的鉤子（`go`、`stand`、`look`、`fakeNow`、`fakeBeats`、`hits`）擺位置與假歌曲。它檢查：各房間、空中歌詞與字幕、進度條拖曳、互動距離、設定卡、播放列、小窗的可點區域、30 秒堆積大小、頁面無錯誤。新增空間功能時在這裡加一段檢查。

記憶體：`test:space` 會量 30 秒的堆積大小（差距須小於 1.5 MB）；經典介面的每幀邏輯改動後也要另外量一次。

**回報時必須區分**：「測過且通過」「只改了邏輯、沒有驗證」「這個環境無法驗證（實體顯示卡、聲音、Windows 視窗行為）」。不把沒驗證的寫成已完成。

修改既有測試的門檻或斷言時，在測試裡註明哪個版本、為什麼改。

## 7. 發佈流程

1. 版本號：`package.json` 與 `package-lock.json`。
2. `docs/RELEASE.md` 最上面加一段，寫給使用者看：改了什麼、為什麼，不寫實作細節。
3. 提交、推到 `space-mode`，再快轉推到 `main`。`main` 上的 `release` 工作流程會建置 Windows 安裝檔與免安裝版並發佈。
4. 等工作流程完成，把發佈頁連結回報給使用者。

## 8. 介面文案（目標：詞彙表在 `docs/COPY.md`，階段 3 定稿）

- 主要畫面不出現技術詞：掃描、分析、解碼、推理、快取、取樣率、位元深度、引擎名稱、API 名稱。這些只在「進階」與「資訊」彈層出現。
- 一個概念只有一個名字，六種語言各一個。先查詞彙表。
- 需求描述裡的臨時稱呼（例如「小窗置頂」「節能模式」「空間模式」「聖堂」）不能直接當產品名稱使用，要經過命名。
- 按鈕是動詞；說明一句話、不超過 30 個中文字；不解釋實作，只說對使用者的結果。
- 進行中的背景工作不顯示計數與進度條，除非使用者主動開啟查看。

## 9. 設計語言（現況：`docs/DESIGN.md` 第二版「舞台」，3.1.0 起）

寫任何畫面之前先讀 `docs/DESIGN.md`。它回答四個問題（東西屬於歌還是屬於音樂庫、顏色從哪來、跟著什麼動、一般人需不需要看到），並列出所有 token 與積木。

硬規則（`tests/unit/arch.test.ts` 強制一部分）：

- 正在播放的歌是舞台（`views/NowPlaying.tsx`＋引擎的畫面）；音樂庫等頁面在同一張紙上（`Shell.tsx` 的 `<main>`）；播放列在兩者之下都是同一條。不新增第三種地方。
- 紙與舞台的進退是一個彈簧進度（`layers.ts` 的 `applyNp`）：只用 transform 與 opacity，不用 clip-path，不在每幀讀版面。
- 顏色來自正在播放的歌：外殼把封面的色相寫成 `--song-h`／`--song-c`，token 由它算出紙、強調色。元件不寫死顏色（頂列例外：它永遠在深色的舞台底上）。
- 選中用反白（`--pick`／`--on-pick`），不用彩色；`--accent` 只表示「這是正在播放的歌」。
- 元件樣式不寫字面的圓角與時長，只用 `src/app/styles/tokens.css` 的 token。按鈕都是膠囊。
- 離場比進場短；可被打斷的動態用彈簧。

還是舊版面的部分（歌曲列表、詳細頁、海報牆、設定頁、彈窗）改到時照 `docs/DESIGN.md` 重做，不照舊樣子修補。

## 10. 已知的債與不要重蹈的坑

- `space/world.ts`：單一巨型閉包、無型別。階段 1 拆分。拆分前要改它，先在這份文件第 3 節的結構裡找到它將來的位置，照那個邊界寫。
- Electron 的拖曳區（`app-region: drag`）不看 z-index：蓋在上面的按鈕仍會被下面的拖曳區吃掉點擊。拖曳區只放在沒有任何按鈕重疊的矩形上。
- Hi-Fi 播放核心獨佔裝置：切回標準輸出時要明確 `release`，否則標準輸出會靜音到它自己放手為止。
- 畫到 WebGL 的 canvas 來源圖片必須 `crossOrigin='anonymous'`，否則每幀丟 SecurityError。
- 軟體繪圖（測試環境）下看不出效能問題；效能結論只能來自實機。
