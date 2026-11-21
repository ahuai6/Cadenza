# Cadenza 架构

本机音乐库播放器：音乐库与高保真播放、节奏分析、多格式歌词、特效歌词、正在播放页、歌词工坊与视频导出、经典与空间两种界面，各部分同样重要、彼此咬合。这份是总览：每个部分做什么、数据怎么流、边界在哪。各部分的规则细节在 `docs/parts/`；它们是由这份文档 3.5.0 之前的内容拆出来的，改程序时改对应的那一份。

| 细节文档 | 管什么 |
| --- | --- |
| [`parts/rhythm.md`](parts/rhythm.md) | 节奏分析的两个引擎、`RhythmMap`、衍生信号、校验、流式分析、数据绑定 |
| [`parts/lyrics.md`](parts/lyrics.md) | 歌词来源与格式（LRC、TTML）、逐行／逐字、和声、翻译与读音、分词与依唱法合词、规则层 |
| [`parts/director.md`](parts/director.md) | 规划顺序、排版、镜头程序、转场时机、触发、标题、清场机制 |
| [`parts/render.md`](parts/render.md) | 图层顺序、特效插件、背景（含 Folia）、转场的样子、正在播放页的背景、显卡歌词层、距离场字形 |
| [`parts/engine.md`](parts/engine.md) | Session 与 Engine、重建层级、背景规划、MV、导出、交接 |
| [`parts/app.md`](parts/app.md) | 界面与引擎的合约、指令登记表、设置纲要、外观与风格页、正在播放页 |
| [`FOLIA.md`](FOLIA.md) | Folia 风格与背景怎么搬进来、怎么跟上游、怎么和 Folia 对照 |
| [`SPACE.md`](SPACE.md) | 空间界面的格局、形状、光、声音、程序结构 |

## 平台

- **Electron + React + TypeScript（strict）**。渲染与导出需要确定性：Electron 自带固定版本的 Chromium（WebView2 随系统变）。纯逻辑模块（节奏、歌词、导演）不依赖 DOM，能在 Node 直接单元测试。
- **高保真输出**是独立的 Rust 进程 `native/cadenza-audio`（WASAPI 独占、比特完美、自适应采样率），主进程以管道与它沟通。
- **神经网络节奏**在桌面版由 ONNX Runtime 在 utility process 执行（`electron/infer*.cjs`；Windows 用 DirectML），没有时退回浏览器 WebGPU，再退回内置的信号分析。

## 分层

```
core ──► text ──► lyrics ──┐
  ├────► rhythm ───────────┼──► director ──► render ──► engine ──► app（React：views/ 经典、space/ 空间）
  ├────► theme ────────────┤        ▲           ▲
  └────► i18n              └──► folia ──────────┘   （Folia 的风格与背景：在 director 旁、render 之下）
electron（主进程：音乐库、设置、窗口、Hi-Fi、原生推理）   native（Rust 播放核心）
```

现行目录边界由 `tests/unit/arch.test.ts` 检查。它用 Vite 的 TypeScript AST 与模块解析识别静态导入、重导出、类型引用、字面量动态导入及别名。运行时图排除纯类型依赖。计算生成的路径与 IPC 流程另用行为测试。

- 每个模块只能引用它下层的模块；`lyrics` 用自己的最小接口 `BeatGrid` 读节拍，不引用 `rhythm`。
- 目前界面经 `src/engine/index.ts` 访问引擎下层，另可访问 `core`、`theme`、`i18n`。4.0.0 的目标是按播放、视觉和共享契约设置入口，迁移时同步更新测试。
- `app` 里：`views/` 与 `space/` 互不引用；逻辑层（`state.ts`、`bridge.ts`、`playback/`、`actions/`、`commands/`、`settings/`）不引用任何画面；只有 `bridge.ts` 碰主进程；空间的场景只经过 `space/bind.ts` 读写 Cadenza。
- 组件样式不写字面的圆角与时长（只用 `styles/tokens.css`）。

G0 记录了 10 条现有运行时循环边，涉及四组模块。`AlbumLine ↔ Library` 以及 `Effect / Modals / Settings` 的解环留到界面治理。`rhythm/index ↔ rhythm/stream` 随分析调度治理。`lyrics/parse ↔ lyrics/ttml` 是解析和转换的现有耦合，后续改动相关职责时处理。测试允许移除已有边，并拒绝新增循环边。

## 七个部分怎么咬合

| 部分 | 做什么 | 主要位置 | 读谁、被谁读 |
| --- | --- | --- | --- |
| 音乐库与播放 | 扫描文件夹、标签与封面、歌单与收藏、队列；普通与高保真输出、音量平衡 | `electron/`、`native/`、`src/app/playback` | 3.6.0 的页面状态持有目标和展示项，`Engine` 持有输出与结束事件 |
| 节奏 | 拍点、强拍、重音、鼓点、段落与频段。库按曲目 ID 保存分析，当前扫描使用抽样 `audioKey` | `src/rhythm`、`electron/infer*.cjs` | 在给定播放时间下提供事件与特征，供导演、特效、Folia 和空间使用 |
| 歌词 | 解析、分词、依唱法合词、翻译与读音、在线取得、写回文件 | `src/lyrics`、`src/text` | 唯一的文字来源：播放列、正在播放页、特效歌词、Folia、空间 |
| 特效歌词 | 导演规划（或 Folia 的引擎），渲染器与特效插件画出来；可导出视频 | `src/director`、`src/render`、`src/folia`、`src/engine` | 读节奏与歌词；风格与外观来自 `theme` |
| 正在播放页 | 封面、逐字上浮的歌词、等待的三点；背景由引擎画；与特效歌词无缝交接 | `views/NowPlaying.tsx`、`ui/NpLyrics.tsx` | 读歌词模型、节奏（三点的拍）、引擎的环境视图 |
| 歌词工坊 | 校时、分词、风格调整、导出 | `views/workshop`、`app/workshop` | 与特效歌词同一页「外观与风格」 |
| 两种界面 | 经典与空间，共用逻辑、指令登记表、设置纲要 | `src/app` | 见 `parts/app.md`、`SPACE.md` |

**改一处之前，先查它还被谁用。** 例如改节奏的事件选择，会同时改变特效歌词的闪光、正在播放页的三点、专辑线的环、Folia 的拍点特效和空间的灯。

## 时间模型

- **歌曲时间** `t`（秒）用 Session 的 `audioStart` 把输出文件位置换算到歌词时间轴。节奏图提供这个时刻附近的事件与特征。
- **3.6.0 现况**为普通输出用 Web Audio 时标，高保真用原生样本队列与 padding 估时。页面与桌面歌词还会各自外推。两条路径的真实端点误差需独立测量。
- **4.0.0 目标**为播放端提供带代次的输出时钟。缓冲、暂停、跳转和设备恢复有统一语义。菜单与页面使用界面单调时钟，离线导出用帧时刻，无音频工坊可用项目时钟。
- `evaluate(plan, t)` 是导演的求值入口。预览与导出的完整画面还涉及媒体帧、字体、特效状态和合成路径，使用逐帧对照验证一致性。

## 一帧的数据流

```
音频档 ──► 节奏分析（worker／原生推理，缓存）──► RhythmMap ──┐
歌词档 ──► parseLyrics ──► 分词与合词 ──► 歌词模型 ──────────┼──► Session
外观＋风格（theme/style.ts，每首歌各自绑定）─────────────────┘        │
                                                                    ▼
                         导演 plan（worker）→ ScenePlan   或   Folia 引擎（engine 字段）
                                                                    │
时钟 t ──► Engine.frameAt(t) ──► RenderFrame ──► renderer：背景 → 歌词 → 特效 → 转场的样子 → 字幕 → 屏幕特效
```

## 登记表（扩充点）

新增东西是「登记一笔」，不是改核心：

| 要加的 | 登记在 | 界面自动 |
| --- | --- | --- |
| 特效、背景 | `render/effects/registry.ts` 的 `register()` | 依 `params` 产生控制项 |
| 镜头程序 | `director/cameras.ts` 的 `registerCamera()` | 镜头菜单 |
| 转场的样子 | `render/transitions.ts` 的 `registerTransition()` | 转场菜单 |
| 风格（动态） | `theme/style.ts` 的 `MOTIONS`（可带 `engine`） | 风格分页 |
| 外观 | `theme/style.ts` 的 `PRESETS` | 外观分页 |
| 歌词引擎（Folia 风格） | `render/engines.ts` | 〈风格名〉的设置 |
| 用户动作 | `app/commands/` 的 `define()` | 两种界面的菜单 |
| 设置 | `app/settings/schema.ts` | 设置页字段、类型、默认值 |
| 分词规则 | `lyrics/rules.ts` 的 `WORD_RULES` | — |
| 歌词符号（`#1`、`@N`、`$1`…） | `lyrics/parse.ts` 的 `CUE_SYMBOLS` | 编辑器的按键 |

流程与检查清单在 `.claude/skills/cadenza/SKILL.md` 第 4 节。

## 主进程（`electron/`）

应用进程在加载主服务前由 `profile.cjs` 按构建阶段、程序版本与数据代次检查资料。Windows 先验证路径，再在原有用户资料根上取得 Electron 单实例锁。清理或迁移成功后才读设置、连接曲库与启动窗口。已知旧资料的退役与清理由持久化的事务记录恢复，Chromium 单实例锁与应用控制记录独立于被处理的数据条目。发行阶段和测试入口见 [维护](MAINTENANCE.md#400-启动与数据断代)。

- `main.cjs`：窗口、托盘、协定（`cadenza://` 提供封面、音频、字体、模型）、媒体键、程序自己的设置（`settings.json`，默认值档 `settings.defaults.json` 由纲要产生）。
- `library.cjs`：扫描、标签（node-taglib-sharp）、封面、歌单、`audioKey`（略过标签区块的音频哈希，改标签不会重新分析）、歌词写回标签（临时副本再改名）。
- `audio.cjs`：与 Rust 高保真播放核心的管道（页面只给歌曲 id，看不到路径）。
- `desk.cjs`：桌面歌词的独立窗口。
- `infer.cjs`／`inferHost.cjs`：原生推理的 utility process。
- `preload.cjs`：暴露给页面的 API；页面只经过 `src/app/bridge.ts` 使用。新增能力三处都要改：`ipcMain.handle` → `preload.cjs` → `bridge.ts`。

受平台保护的文件（`.ncm`、`.qmc*`、`.kgm` 等）只列出并标示，绝不解密、不播放。
