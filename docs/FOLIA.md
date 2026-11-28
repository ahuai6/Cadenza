# Folia 的特效歌词在 Cadenza 里

Folia（https://github.com/chthollyphile/folia-major，AGPL-3.0，与 Cadenza 相同）的歌词可视化作为风格接入特效歌词。初次移植以保持上游构图为基准，生成文件保留来源与版本。G7 可以在可追踪、可回归和可同步的前提下改良构图、运镜与特效算法，详见 [项目方向](DIRECTION.md#g7-风格构图与共享-gpu-基础设施)。

## 结构

| 位置 | 内容 | 谁维护 |
| --- | --- | --- |
| `src/folia/upstream.json` | 钉住的上游版本、要搬的文件、要抽出的声明、转接（shim）、少数必要的修补 | Cadenza |
| `src/folia/vendor/` | 上游文件，路径与上游相同（去掉开头的 `src/`）；**不手改** | `scripts/folia-sync.mjs` 产生 |
| `src/folia/pixi/` | 与 Pixi v8 兼容的舞台。稳定贴图和简单几何使用共享图集与 GPU 批次，GLSL 滤镜使用同上下文的帧缓冲。字形栅格、路径和特殊混合保留 Canvas2D 路径 | Cadenza |
| `src/folia/shim/` | 上游依赖、Cadenza 另有来源的模块：动态信号、节拍来源、图标、framer-motion 的类型 | Cadenza |
| `src/folia/adapt.ts` | Cadenza 的歌词模型 → Folia 的 `Line`（用 Cadenza 的分词，含用户自订）；外观 → Folia 的 `Theme` | Cadenza |
| `src/folia/live.ts` | 每个视觉实例各自推进节拍状态。频段和节拍按当前媒体时间采样，实际音乐特征优先取已覆盖的分析区间 | Cadenza |
| `src/folia/engines/` | 各风格的执行层（取代上游的 `create…PixiRuntime.ts`） | Cadenza |
| `src/render/engines.ts` | 根据风格登记选择视觉世界、时间与参数接入。Folia 拥有自己的镜头和转场，公共背景及屏幕效果在外层合成 | Cadenza |

G8 的同步清单登记了商籁装饰种子与音乐时间改动。对照工具可连续采样并输出 Shot、镜头和转场时刻。 [G8 原生场景验证](G8.md#folia-原生场景)

分层：`folia` 在 `director` 旁、`render` 之下（`tests/unit/arch.test.ts`）。

## 跟上游更新

```
git clone https://github.com/chthollyphile/folia-major /tmp/folia && git -C /tmp/folia checkout <新版本>
# 改 src/folia/upstream.json 的 commit
node scripts/folia-sync.mjs /tmp/folia
npx tsc --noEmit -p . && FOLIA_UPSTREAM=/tmp/folia npx vitest run tests/unit/folia.test.ts
```

同步脚本遇到未对应的 import、找不到的声明、或某条修补不再吻合时会失败并列出来，不会默默搬进坏掉的文件。新增一个上游模块：加进 `copy`，若它依赖 Cadenza 另有来源的东西就加 shim。

## 上游文件 → Cadenza

| 上游 | Cadenza |
| --- | --- |
| `components/visualizer/sonnet/*.ts`（构图、排版、MG、转场、后制滤镜、片尾） | `src/folia/vendor/components/visualizer/sonnet/`（原样） |
| `sonnet/createSonnetPixiRuntime.ts` | `src/folia/engines/sonnet.ts`（重写：场景缓存、逐帧更新、片尾模糊照搬，画布与时钟交给 Cadenza） |
| `sonnet/sonnetIcons.ts`（React 渲染 Lucide） | `src/folia/shim/sonnetIcons.ts`（内置数个 Lucide 图标的 SVG，其余函数照搬） |
| `sonnet/VisualizerSonnet.tsx`、`SonnetSettingsPanel.tsx`、`tuning.ts` | Cadenza 的风格页与设置（不搬） |
| `components/visualizer/tempera/*.ts`、`compositions/*.ts`（构图、色块、排线、反相滤镜、景深、墨迹、转场、片尾） | `src/folia/vendor/components/visualizer/tempera/`（原样） |
| `tempera/createTemperaPixiRuntime.ts` | `src/folia/engines/tempera.ts`（重写：场景缓存、预卷、色块扫过、墨迹与景深开关照搬；换歌与用户图层交给 Cadenza） |
| `tempera/tuning.ts`、`Tempera*Panel/Controls/Dialog*.tsx`、`useTemperaLayerImageThumbnails.ts` | Cadenza 的风格页（不搬） |
| `services/analysis/drumHits.ts`（浏览器内分离鼓轨） | `src/folia/shim/drumHits.ts`（鼓点来自 Cadenza 节奏分析的 htdemucs 鼓轨） |
| `pixi.js` 的 `Mesh` + 自订着色器（墨迹闪光） | `src/folia/pixi/mesh.ts` + `gl.ts` 的网格绘制 |
| `services/beatFx/beatFxLive.ts`、`clock.ts` | 拍点来自 `src/folia/live.ts`。同步清单补上可选的绝对媒体时间接入，复用上游包络常数和重音曲线 |
| `services/beatFx/beatFxSource.ts`（Beat This! 推理、分轨） | `src/folia/shim/beatFxSource.ts`（只留类型；拍点来自 Cadenza 的节奏） |
| `stores/motionSignals.ts` | `src/folia/shim/motionSignals.ts` |
| `types.ts` | 由同步脚本抽出需要的声明到 `src/folia/vendor/types.ts` |
| `utils/lyrics/graphemeTiming.ts`、`renderHints.ts`、`wordSegmentation.ts`、`utils/fontStacks.ts`、`colorMix.ts` | 原样 |
| `pixi.js` | `src/folia/pixi/` |
| `components/visualizer/backgrounds/*`（通用、隐现、空、莫奈、漫游；React 图层） | `src/folia/backgrounds.ts` 逐格画在 Cadenza 的画布上（`src/render/effects/foliaBackdrops.ts` 登记成背景）；纯计算的部分（隐现的速度与配色、空的着色器、莫奈的上色与漂移、漫游的放大量、通用的封面柔焦）由同步脚本抽出原样使用 |
| `@paper-design/shaders-react` | `src/folia/paper.ts`：用同一个套件的 `ShaderMount` 与片段着色器，依歌曲时间画一格 |
| 背景配色 | 只用 Cadenza 外观的颜色（背景、文字、强调、闪光色）与封面取色；不接 Folia 的主题色生成 |

## 与 Folia 本身对照

四支脚本把同一份歌词、主题、拍点与时间点交给 Folia 自己的执行层（真正的 Pixi 8 与它的 React 背景，`tests/folia-ref/` 在 Folia 的 checkout 里建置）与 Cadenza 的移植，逐格截图比较：舞台、全曲（静止与播放中）、背景（静止与动态）。指令、做法与最近一次的数字在 `docs/TESTING.md` 的「Folia 对照」。

## 交给 Folia 的输入

- **时间**：逐字计时的行用各字的时间；只有整行时间的行照 Folia 自己的 LRC 读法（`estimatedLineTiming.ts`）：持续到下一行，间隔很长时不超过读完的时间加两秒，字平均分在九成的时间里。每行都带 Folia 的 render hints（`renderHints.ts`）。
- **分词**：默认用 Cadenza 的分词（含用户自订）；风格设置「用 Folia 自己的分词」打开时改给 Folia 的自动分词（同一个 icu-folia 分词器）。
- **频段**：Folia 的五个频段（20–150、150–400、400–1200、1000–3500、3500–12000 Hz）与它的放大曲线，从 Cadenza 节奏分析的频谱读出；power 照 Folia 由低音与中低音算。
- **分析共享**：移植对照锚点仍为上游 `6ee9404`。网络推理、HPSS 门槛、分鼓模型及拍上重音计算留在节奏层，Folia 优先读取同一份 `RhythmAnalysis.accents`，通过自己的信号层表达构图与动效。DSP 路径仍从共享事件和频谱统计推导需要的视觉信号。 [G6 分析契约](G6.md)
- **拍点**：每拍的力道与音色照 Folia 的 beatAccents：拍上低、中、高音的上升（对前 40–120 毫秒）与周围的响度，各自在整首里规范化后混合；没有鼓的小节不触发拍点特效（以分离出的鼓轨判断）。

## 拆开与交叉搭配

能从 Folia 的风格拆出来、给任何风格用的部分，各自登记成 Cadenza 的东西：

| 拆出的 | 登记成 | 位置 |
| --- | --- | --- |
| 画面处理（颗粒、网点、色偏、暗角、镜头弧度） | 特效「画面处理」 | `render/effects/folia.ts` |
| 版面标记（商籁的线框与标记） | 特效「版面标记」 | 同上 |
| 五种背景 | 背景 `f-*` | `render/effects/foliaBackdrops.ts` |
| 商籁的段落转场（模糊、撕裂、淡出） | 转场的样子 `blur`、`glitch`、`fade` | `render/transitions.ts` |

商籁和凝彩由各自的执行层运镜。`Engine.frameAt()` 仍计算 Cadenza 导演帧，通用背景、合成和转场可继续消费这份帧数据。G7 需要在对照测试中查清跨风格影响，把构图、镜头和转场的所有权归还给各自风格，再通过明确的组合接口共享底层资源。

## 还没搬的

上游 `components/visualizer/` 下其余风格（cappella、claddagh、classic、diorama、fume、hanabi、lumiere、machi、metaphor、nebbia、partita、pendolo、still、tilt…）保留在后续积压。4.0.0 重构优先保证现有风格的还原、效果组合和上游同步，见 [项目方向](DIRECTION.md) 与 [3.6.0 对照基线](BASELINE-3.6.0.md)。

## 授权与注意

- 搬进来的每个文件开头标明来源与版本。上游文件里的 `@note Version Control` 等注释保留原样。
- 对上游生成文件的修订通过同步脚本和 `upstream.json` 的 `patches` 记录，说明改动原因、适用的上游版本及验证方法。Cadenza 自有执行层的改良也要有对应的上游对照。
- Lucide 图标为 ISC 授权；Paper 着色器（`@paper-design/shaders`）为 Apache-2.0 授权。
