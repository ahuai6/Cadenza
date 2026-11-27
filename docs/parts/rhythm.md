# 节奏（`src/rhythm`）

节奏分析提供时间轴上的拍点、段落、重音和其他特征。导演、特效、正在播放页、专辑节奏环、Folia 和空间需要这些特征时读取 `RhythmMap`。当前播放位置来自音频输出，界面交互使用界面时钟。总览在 `docs/ARCHITECTURE.md`。

G7 在原内容缓存中记录已取得的实际质量，模型恢复后补全现有结果。比较缓存前先读取旧行的已验证分析，避免把缺少质量字段的完整结果重新分析。Folia 直接读取 DSP 发布的事件或神经网络的拍点、重音与 trackScale，鼓轨失败保留已完成的部分。详见 [G7](../G7.md#g6-修缮)。

## 接口

```ts
analyze(pcm: Float32Array[], sampleRate: number, opts?): RhythmAnalysis   // 在 Worker 中执行
class RhythmMap {
  constructor(a: RhythmAnalysis, audioStart: number)  // 文件时间 → 歌曲时间
  beatAt(t): BeatPos                        // { bt 连续拍号, phase 拍内相位, inBar 小节内第几拍, … }
  timeOf(bt), beatLen(t), snap(t, tol, div) // 拍号 ↔ 时间、对齐格线
  grid(t0, t1, div): number[]               // 拍、半拍、三连音…
  eventsIn(t0, t1, minTier?), eventNear(t, tol?, minTier?), accentAt(t)
  select(opts): RhythmEvent[]               // 依灵敏度选事件（闪光/冲击/碎玻璃共用）
  level(t), loud(t), spec(t), sounding(t), section(t), build(t)
}
interface RhythmEvent { t; s /* 感知强度，约 0..3 */; tier: 0|1|2 /* 轻/中重/重 */; band: 'low'|'mid'|'high'|'broad';
                        pos: number /* 小节内位置（拍） */; off: boolean /* 反拍 */; push?: number /* 抢拍：所属的拍 */ }
accentClock(map, t): number                 // 漂浮物共用的时间：重拍时减速、悬停再恢复（羽毛、花瓣、光点…）
```
`accentClock` 从给定的歌曲时间计算按节奏变速的动画进度，预览与导出使用同一张表。需要重音变速的漂浮效果使用这一映射。固定时长的动效直接使用所属时间域。
算法（细节见 `src/rhythm/README.md`）：多频带对数频谱通量 → 自适应阈值取峰（抛物线内插的精确时间）→ 节奏图（tempogram）+ 感知先验估速 → 动态规划拍点追踪 → 小节/拍号/乐句 → 每个起音的**感知显著度**（音量、频带、相对于同位置的意外度、节拍位置）分三层 → 切分/弱起标记 → 自相似新颖度切段落、能量、渐强与爆点。
一拍内可以有多个不同强度的事件；最小间隔取感知融合门槛（约 70 ms）。

### 两个引擎，一个接口

拍点可以由两个引擎找出，但输出永远是同一份 `RhythmAnalysis`。下游所有模块（`RhythmMap`、`Signals`、Director、特效）只读这份数据，不必知道是哪个引擎做的。

- **神经网络引擎**（`src/rhythm/neural`，移植自 [Folia](https://github.com/chthollyphile/folia-major)，见 `NOTICE.md`）：
  - **拍点与强拍**：Beat This! 在 WebGPU 上推理，以 30 秒为一块，不用 DBN，直接取 logit 峰值。
  - **每拍重音**：包括「感受到的拍」（6/8 拍或被数成两倍速的慢歌会换算回来）、HPSS 律动门槛，以及模型拿不准的段落。
  - **鼓点**：HTDemucs 分出鼓声后，分底鼓、军鼓、钹三类找出鼓点；没有鼓的歌不给鼓点。
  - **执行方式**：在自己的 Worker 中执行，独占一个 GPU device，以 `auto` 切片提交，不抢歌词绘制的帧。
  - **本机加速**（桌面版，2.11）：两个网络改由 ONNX Runtime 在独立的 utility process 执行（`electron/infer.cjs`；Windows 用 DirectML，macOS 用 Core ML，其他或失败时用 CPU）。只换「跑网络」这一步：梅尔频谱、30 秒窗口（补到 1500 帧）、HTDemucs 分段、峰值选取、鼓点与人声判读都还在 Worker 里，Worker 以 RPC（`{rpc, op, args}`）经页面的 `NativeRuntime`（`src/app/engineConfig.ts` → `window.cadenzaInfer` → `infer:run`）调用主行程（`electron/inferHost.cjs`），一次一个请求，闲置两分钟后结束该行程。HTDemucs 分段长度用 ONNX 导出版的 343980 样本。
  - **本机模型**：用户在「设置 → 节奏引擎」按下载才取得（`beat_this.onnx`、`htdemucs.onnx`，约 356 MB，各自钉选上游 revision 并校验 SHA-256，先写 `.part` 再改名），存在 `userData/models/native`（测试可用 `CADENZA_NATIVE_MODELS` 指定）。首次加载时把优化后的图存到 `cache/`（依执行提供者与 ORT 版本分档），之后以 `graphOptimizationLevel: 'disabled'` 直接打开，加载从数十秒降到不到一秒。
  - **选择**：设置 `rhythmRuntime`（`auto` 本机优先／`webgpu` 只用浏览器 GPU）与 `rhythmDevice`（`auto` GPU 优先／`cpu`）。模型未下载、平台没有对应的二进位档或启动失败时，可回到 WebGPU 核心；`neuralStatus()` 的 `native` 标记决定 Worker 走哪条路。
- **内置引擎**（`analyze.ts` 第 3–5 步）：没有 WebGPU、没有模型档，或用户在设置中选择「内置」时使用。
- **接合点**：`analyzeInBackground` 先取得神经网络的读数（`NeuralRhythm`），再交给 `analyze()`：
  - 第 3–5 步改用它的拍点和逐小节强拍（`bars`）；
  - 第 6 步以鼓点为事件，其他乐器的起音保留在旁边；没有律动的小节不出重拍；
  - 每拍重音写入 `accents`，`Signals.grooveHits` 直接使用。
  - 第 1、2、7 步两个引擎完全相同。结果带 `engine` 和 `beatEvidence` 字段，版本为 4。
- **模型档**：`beat_this-wgsl.bin` 和 `htdemucs-wgsl.bin` 都是 MIT 授权，不进 git。`scripts/models.mjs` 按 `src/rhythm/neural/models.json` 的 SHA-256 下载并校验，打包进 `resources/models`，再由主行程以 `cadenza://model/` 提供（只提供这两个文件）。

**衍生信号**（`Signals`）由事件流以解析式脉冲响应叠加得到，**决定性**（导出与预览一致）：
- `pulse(t)`：快速起音、指数衰减的脉冲（背景呼吸、光环、频谱）；
- `cone(t)`：二阶阻尼弹簧（低音扬声器纸盆），重拍推出、带一次微小回弹；镜头的「弹动」只读它；
- `energy(t)`、`sounding(t)`：平滑能量与「是否真的有音乐在响」。

**完整性校验**（`rhythm/validate.ts` 的 `checkAnalysis(a, duration?)`）：一份分析只有通过校验才会被存下或使用——版本、拍点递增且覆盖全曲、速度与拍距一致（容许 6%，含 ½、2、⅓、3、⅔、1.5 倍的读法）、事件与小节在范围内。自动模式可在模型不可用时使用内置引擎。完整结果校验失败会记录原因，等待手动请求或内容及算法版本变化。缓存里尚未校验过的分析，在背景队列清空后逐一检查，坏的退回重新分析。

**流式分析**：本地曲库走 G6 的 PCM 分块输入、单任务队列和内容缓存。播放与歌词先到，等待期间没有猜测的拍点。完整结果经校验后由 `Session.stage()` 接入当前会话，现有引擎负责视觉修订的交接。工坊或有声导出仍可显式请求离线 PCM。 [G6 输入与生命周期](../G6.md)

**数据与音频的绑定**：缓存使用 G5 验证的 `AudioContentId`、实际分析配置和独立的数据版本。内容 SHA-256 与曲库条目身份独立。标签、封面或歌词变化时，只要重新验证得到相同内容即可复用分析。 [内容身份与修订](../IDENTITY.md)
