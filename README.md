# Cadenza

Cadenza 是一套個人音樂庫播放器，主打「特效歌詞」：它會分析每首歌的節奏，再按節奏生成歌詞動畫。前身是 Lyric Motion，這一版從頭重構。

- **音樂庫**：掃描你選定的資料夾，讀取標籤、封面與同名 `.lrc`。也可以手動修改歌曲資訊，或從 MusicBrainz、iTunes、Cover Art Archive 查找標籤與封面。
- **播放**：支援播放列表與四種播放模式。隨機播放會加權，播放次數少的歌更容易被選中。另有 Hi-Fi 輸出（WASAPI 獨佔、位元完美）。
- **正在播放**：背景直接由引擎繪製，用的是這首歌的封面與節奏；歌詞逐字浮起。
- **特效歌詞**：從正在播放頁無縫交接，封面和歌詞會飛入畫面。每首歌各自綁定主題、動態與特效設置，也可以綁定 MV。
- **歌詞工坊**：獨立的專案，可以導出 MP4（WebCodecs）。
- **網頁版**：`dist-web/web.html` 是單一 HTML 檔案，內含完整的歌詞工坊。

本程式嚴格遵守各平台的授權與 DRM。串流平台加密的檔案（`.ncm`、`.qmc*`、`.kgm` 等）只會列出，並標示為「受平台保護」，絕不解密、不播放。

## 架構

詳見 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)，審查結論見 [`docs/AUDIT.md`](docs/AUDIT.md)。

```
core → rhythm（節奏 SDK）→ director（規劃）→ render（繪製與特效插件）→ engine（時鐘、Session、交接、導出）→ app（介面）
lyrics / text / theme / i18n 為葉子模組
```

- **節奏 SDK**（`src/rhythm`）：做起音偵測、速度、拍點、小節與強拍、重拍分級、反拍與搶拍、段落、Drop 與 Build。分析在 Worker 中進行，結果以 `RhythmAnalysis` 帶版本快取。查詢介面是 `RhythmMap`，彈簧訊號由 `Signals` 提供。
- **Director**：歌曲載入時一次規劃版面、鏡頭路徑、轉場與片頭。播放時只按時間求值，所以預覽、預讀和導出畫出的畫面完全一致。
- **特效**：在 `src/render/effects` 註冊（id、圖層、參數定義、`draw`）。介面會依參數定義自動產生控制項。
- **介面動態**：多部件的動畫都由同一個彈簧進度驅動，可以隨時反向，不會卡在半途。

## 開發

```sh
npm install
npm run typecheck && npm test            # 單元測試（節奏、歌詞、Director）
npm run build:app                        # 桌面介面 → dist-app（含全部字型，可離線使用）
npm run build:web                        # 網頁版工坊 → dist-web/web.html
npx vite build --mode harness && node tests/render.cjs   # 繪製測試（主題、裁剪、效能、導出）
xvfb-run -a node tests/desktop.cjs <截圖資料夾>          # 桌面端到端測試
node tests/hifi.cjs && xvfb-run -a node tests/desktop-hifi.cjs   # Hi-Fi（模擬 DAC）
npm run dist:win                         # Windows 安裝檔與免安裝版（release/）
```

Hi-Fi 輸出是 `native/cadenza-audio`（Rust）。在 Linux 上可用 `x86_64-pc-windows-gnu` 交叉編譯。
