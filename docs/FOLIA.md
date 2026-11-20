# Folia 的特效歌詞在 Cadenza 裡

Folia（https://github.com/chthollyphile/folia-major，AGPL-3.0，與 Cadenza 相同）的歌詞視覺化以「風格」的身分接進經典介面的特效歌詞。原則：**上游的構圖程式碼原封不動地搬進來，只重寫擁有畫布與時鐘的那一層**，所以能隨時跟上游更新。

## 結構

| 位置 | 內容 | 誰維護 |
| --- | --- | --- |
| `src/folia/upstream.json` | 釘住的上游版本、要搬的檔案、要抽出的宣告、轉接（shim）、少數必要的修補 | Cadenza |
| `src/folia/vendor/` | 上游檔案，路徑與上游相同（去掉開頭的 `src/`）；**不手改** | `scripts/folia-sync.mjs` 產生 |
| `src/folia/pixi/` | 與 Pixi v8 相容的舞台（Container、Graphics、Text、Sprite、濾鏡、遮罩、混合模式），以 Canvas2D 畫圖形與文字、WebGL2 跑 GLSL 濾鏡；上游 `import 'pixi.js'` 改指向這裡 | Cadenza |
| `src/folia/shim/` | 上游依賴、Cadenza 另有來源的模組：動態訊號、節拍來源、圖示、framer-motion 的型別 | Cadenza |
| `src/folia/adapt.ts` | Cadenza 的歌詞模型 → Folia 的 `Line`（用 Cadenza 的分詞，含使用者自訂）；外觀 → Folia 的 `Theme` | Cadenza |
| `src/folia/live.ts` | 節拍時鐘（上游 `beatFxLive`）與頻段，全部由 Cadenza 的節奏分析供給 | Cadenza |
| `src/folia/engines/` | 各風格的執行層（取代上游的 `create…PixiRuntime.ts`） | Cadenza |
| `src/render/engines.ts` | 依風格的 `engine` 欄位選歌詞引擎；導演是預設，Folia 風格畫在同一個背景上 | Cadenza |

分層：`folia` 在 `director` 旁、`render` 之下（`tests/unit/arch.test.ts`）。

## 跟上游更新

```
git clone https://github.com/chthollyphile/folia-major /tmp/folia && git -C /tmp/folia checkout <新版本>
# 改 src/folia/upstream.json 的 commit
node scripts/folia-sync.mjs /tmp/folia
npx tsc --noEmit -p . && FOLIA_UPSTREAM=/tmp/folia npx vitest run tests/unit/folia.test.ts
```

同步腳本遇到未對應的 import、找不到的宣告、或某條修補不再吻合時會失敗並列出來，不會默默搬進壞掉的檔案。新增一個上游模組：加進 `copy`，若它依賴 Cadenza 另有來源的東西就加 shim。

## 上游檔案 → Cadenza

| 上游 | Cadenza |
| --- | --- |
| `components/visualizer/sonnet/*.ts`（構圖、排版、MG、轉場、後製濾鏡、片尾） | `src/folia/vendor/components/visualizer/sonnet/`（原樣） |
| `sonnet/createSonnetPixiRuntime.ts` | `src/folia/engines/sonnet.ts`（重寫：場景快取、逐幀更新、片尾模糊照搬，畫布與時鐘交給 Cadenza） |
| `sonnet/sonnetIcons.ts`（React 渲染 Lucide） | `src/folia/shim/sonnetIcons.ts`（內建數個 Lucide 圖示的 SVG，其餘函式照搬） |
| `sonnet/VisualizerSonnet.tsx`、`SonnetSettingsPanel.tsx`、`tuning.ts` | Cadenza 的風格頁與設定（不搬） |
| `components/visualizer/tempera/*.ts`、`compositions/*.ts`（構圖、色塊、排線、反相濾鏡、景深、墨跡、轉場、片尾） | `src/folia/vendor/components/visualizer/tempera/`（原樣） |
| `tempera/createTemperaPixiRuntime.ts` | `src/folia/engines/tempera.ts`（重寫：場景快取、預捲、色塊掃過、墨跡與景深開關照搬；換歌與使用者圖層交給 Cadenza） |
| `tempera/tuning.ts`、`Tempera*Panel/Controls/Dialog*.tsx`、`useTemperaLayerImageThumbnails.ts` | Cadenza 的風格頁（不搬） |
| `services/analysis/drumHits.ts`（瀏覽器內分離鼓軌） | `src/folia/shim/drumHits.ts`（鼓點來自 Cadenza 節奏分析的 htdemucs 鼓軌） |
| `pixi.js` 的 `Mesh` + 自訂著色器（墨跡閃光） | `src/folia/pixi/mesh.ts` + `gl.ts` 的網格繪製 |
| `services/beatFx/beatFxLive.ts`、`clock.ts` | 原樣；由 `src/folia/live.ts` 餵 Cadenza 的拍點 |
| `services/beatFx/beatFxSource.ts`（Beat This! 推理、分軌） | `src/folia/shim/beatFxSource.ts`（只留型別；拍點來自 Cadenza 的節奏） |
| `stores/motionSignals.ts` | `src/folia/shim/motionSignals.ts` |
| `types.ts` | 由同步腳本抽出需要的宣告到 `src/folia/vendor/types.ts` |
| `utils/lyrics/graphemeTiming.ts`、`renderHints.ts`、`wordSegmentation.ts`、`utils/fontStacks.ts`、`colorMix.ts` | 原樣 |
| `pixi.js` | `src/folia/pixi/` |

## 授權與注意

- 搬進來的每個檔案開頭標明來源與版本。上游檔案裡的 `@note Version Control` 等註解保留原樣。
- 只有 `upstream.json` 的 `patches` 改動上游文字，每條註明原因（目前都是 Cadenza 編譯器較嚴格而未使用的名稱）。
- Lucide 圖示為 ISC 授權。
