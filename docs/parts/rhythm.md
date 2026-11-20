# 節奏（`src/rhythm`）

節奏分析是全專案「跟著音樂動」的唯一來源：導演、特效、正在播放頁、專輯線的節奏環、Folia 風格的拍點與頻段、空間裡的光和聲音都讀同一份 `RhythmMap`。總覽在 `docs/ARCHITECTURE.md`。

## 介面

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
  - **本機加速**（桌面版，2.11）：兩個網路改由 ONNX Runtime 在獨立的 utility process 執行（`electron/infer.cjs`；Windows 用 DirectML，macOS 用 Core ML，其他或失敗時用 CPU）。只換「跑網路」這一步：梅爾頻譜、30 秒視窗（補到 1500 幀）、HTDemucs 分段、峰值選取、鼓點與人聲判讀都還在 Worker 裡，Worker 以 RPC（`{rpc, op, args}`）經頁面的 `NativeRuntime`（`src/app/engineConfig.ts` → `window.cadenzaInfer` → `infer:run`）呼叫主行程（`electron/inferHost.cjs`），一次一個請求，閒置兩分鐘後結束該行程。HTDemucs 分段長度用 ONNX 匯出版的 343980 樣本。
  - **本機模型**：使用者在「設定 → 節奏引擎」按下載才取得（`beat_this.onnx`、`htdemucs.onnx`，約 356 MB，各自釘選上游 revision 並校驗 SHA-256，先寫 `.part` 再改名），存在 `userData/models/native`（測試可用 `CADENZA_NATIVE_MODELS` 指定）。首次載入時把最佳化後的圖存到 `cache/`（依執行提供者與 ORT 版本分檔），之後以 `graphOptimizationLevel: 'disabled'` 直接開啟，載入從數十秒降到不到一秒。
  - **選擇**：設定 `rhythmRuntime`（`auto` 本機優先／`webgpu` 只用瀏覽器 GPU）與 `rhythmDevice`（`auto` GPU 優先／`cpu`）。模型未下載、平台沒有對應的二進位檔或啟動失敗時，自動回到 WebGPU 核心；`neuralStatus()` 的 `native` 標記決定 Worker 走哪條路。
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
