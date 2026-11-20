---
name: cadenza
description: Cadenza 项目的开发范式：分层与依赖规则、新增功能／设置／特效／空间对象的固定流程、测试与发布流程、界面文案与设计语言的规则。在这个项目里写任何代码、文案或设计之前加载。
---

# Cadenza 开发范式

> 状态：3.5.0。标「现况」的是今天代码里成立的事；标「目标」的是还没做到、之后必须遵守的事。做到一项就把它改成「现况」。
>
> 文档地图在 `docs/README.md`；方向与用户已决定的事在 `docs/DIRECTION.md`；架构在 `docs/ARCHITECTURE.md`（细节在 `docs/parts/`）；测试在 `docs/TESTING.md`；发布与维护在 `docs/MAINTENANCE.md`。

## 1. 这个项目是什么

一个本机音乐库播放器，由几个同样重要的部分组成（各部分与位置见 `CLAUDE.md` 的表）：音乐库与播放（含高保真输出）、节奏分析、歌词（解析、分词、取得）、特效歌词（导演与渲染）、正在播放页、歌词工坊，以及共用同一套逻辑的两种界面（经典与空间）。

它们不是各自独立的功能，而是同一件事的不同出口：**一首歌被听见、被看见、被感觉到节奏**。节奏是唯一的时间来源，歌词模型是唯一的文字来源，播放器状态是唯一的「现在在放什么」——任何画面或声音都从这三者读，不自己另起一套（例如用平均速度自己打拍子、自己计时闲置）。改一处之前，先查它还被谁用。

做任何决定时的优先级：

1. 播放不中断、不走音、不泄漏内存。
2. 画面跟音乐是同一件事（任何动态都应该能回答「它跟着音乐的什么在动」）。
3. 界面安静、成熟：技术细节不出现在主要画面上。
4. 代码让下一个人看得懂、接得上。

## 2. 分层（现况，由 `tests/unit/arch.test.ts` 强制）

```
core      数学、颜色、乱数、事件。不依赖任何东西。
rhythm    节奏分析与 RhythmMap。             ← core
lyrics    歌词解析与模型。                    ← core, text
text      字体、文字量测、分词。
theme     风格数据（外观、动态、旋钮）。纯数据。
director  排版、运镜、转场的规划（纯函数，可在 worker 跑）；镜头程序登记表。
folia     Folia 的风格与背景（上游原样搬入＋Cadenza 的执行层）。在 director 旁、render 之下。
render    把规划画出来；特效、背景、转场的样子都是登记表里的插件。
engine    Session（一首歌的一切）＋ Engine（时钟、画布、输出）。对外只有 engine/index.ts。
app       界面。只能引用 engine/index.ts、core、theme、i18n。
  ├ state.ts / bridge.ts / playback / actions   逻辑（两种界面共用）
  ├ ui/        两种界面共用的组件
  ├ views/     经典界面
  └ space/     空间界面
electron  主进程：音乐库、设置、窗口、Hi-Fi 输出、原生推理。
native    Rust 的 Hi-Fi 播放核心。
```

规则：

- `views/` 与 `space/` 互不引用。两边都要用的东西放 `ui/`（组件）或逻辑层。
- 逻辑层不引用任何界面。
- 界面不直接碰 `electron`：只经过 `bridge.ts`。
- 空间界面的场景只经过 `space/bind.ts` 读写 Cadenza（它是唯一的门）。

## 3. 功能只定义一次（目标）

现况的问题：同一个功能在经典与空间各写一份（队列、歌词列表、专辑展开、设置页）。之后一律照下面做。

**指令登记表 `src/app/commands/`**：每个用户动作定义一次（名称、图标、何时适用、做什么）。

```ts
// commands/library.ts
define({
  id: 'track.favorite',
  on: 'track',                 // 作用对象：track（一首歌）、tracks（一组歌）、playlist
  section: 'collect',          // play / collect / make / remove；菜单在不同段之间画线
  icon: 'heart',
  label: (t) => tx(isFav(t.track.id) ? 's.unfav' : 's.fav'),
  when: (t, host) => true,     // 不适用就不出现
  run: (t, host) => Lib?.favorite(t.track.id, !isFav(t.track.id)),
});
```

画面组件只做两件事：`menuFor(target)` 取得菜单，`run('track.favorite', target)` 执行。不在 `onClick` 里重写逻辑、名称或提示。需要界面配合的动作（问一个名字、开标签编辑器）通过 `host`：每个界面启动时用 `setHost` 说自己能做什么，做不到的指令在那个界面自动不出现。

现况：歌曲、一组歌、歌单的指令已登记；经典界面的右键菜单与空间界面的卡片按钮都从登记表取。空间的准星右键菜单也从登记表取（3.1.4）。还没接上的：播放控制（上一首、循环方式）、快捷键。**新增一个歌曲库动作：在 `commands/library.ts` 加一个 `define`，两种界面的菜单就都有了。**

**设置纲要 `src/app/settings/schema.ts`**：每个设置声明一次（键、默认值、类型、分组、是否高级、作用范围）。主进程的默认值、`Settings` 类型、两种界面的设置页都由它产生。`advanced: true` 的设置只在「高级」里出现。

现况：`Settings` 类型、界面的默认值、主进程的默认值（`electron/settings.defaults.json`，由 `npm run gen:settings` 产生，单元测试会检查是否过期）已由纲要产生。经典界面的设置页里，开关、选项列由 `<SettingField k="…" />` 依纲要画出：纲要写了 `label`（字典键）、`help`、选项名称（默认是 `label + '.' + 选项`，或 `optionLabel`）的设置，放一个 `SettingField` 就出现；单元测试会检查六种语言的名称都在。**新增设置：在纲要加一项（含 label），跑 `npm run gen:settings`，在设置页合适的分组放 `<SettingField k="新键" />`。** 需要特别画法的（文件夹、输出设备、字体、语言、读取节奏的状态）仍手写。空间界面的设置卡也用同一个组件（`ui/SettingField.tsx`，各页传入自己的列样式），空间的字符串在主字典的 `sp.` 底下（3.1.4）。

**空间的场景是数据 `src/app/space/`**（格局在 `plan.ts`，纯数字、有单元测试；墙的形状在 `shapes.ts`；新增房间或改格局先改这两个；声音的来源——扬声器、收音机、声场——都是 `systems/audio.ts` 的 `SoundSource`，加一个就是在 `SPEAKERS` 放一笔）：

```
scene/      场景描述：房间、对象、光源、可站立区域（纯数据＋建造函数）
render/     后制：墨线、光束、曝光与雾、界面玻璃（现况：已拆出，`render/passes.ts`）
systems/    input、audio、camera、lyrics、interact —— 各自一个档，有类型（现况：`systems/audio.ts`、`systems/lyrics.ts` 已拆出；镜头在 `rigs/`：`walk.ts` 自由行走、`shots.ts` 定点镜位，场景只读取目前控制器的姿态）
entities/   可交互对象：统一接口 { hover, use, hold?, sound? }
rigs/       镜头控制器：walk（自由行走）、director（固定视角／自动运镜）
```

拆出的模块不认识建筑：需要的东西（场景、镜头、声源、声音怎么穿过门）在创建时交给它。这是之后换场景、加收音机与多声道的前提。

新增一个场景＝新增一份场景描述；新增一个可拿起的对象＝实现 entity 界面并登记。不允许再往单一闭包里加东西。

## 4. 新增东西的固定流程

**新增一个功能**

1. 它是不是一个「动作」？是 → 写成指令。它需要记住用户的选择吗？是 → 加进设置纲要。
2. 逻辑写在逻辑层（`playback/`、`actions/`、或主进程），有单元测试。
3. 经典与空间各自接上（多半只是把指令放到合适的位置）。两边都要能用到，除非这个功能本质上只属于一边。
4. 文案：先查 `docs/COPY.md` 的词汇表；没有的词先加进词汇表再用。六种语言一起补。
5. 测试（见第 6 节），然后更新 `docs/RELEASE.md`。

**新增一个特效或背景**（现况）：在 `src/render/effects/` 新增文件并 `register({ id, label, layer, kind, z, params, draw })`（背景是 `kind: 'backdrop'`）；参数由 `params` 声明（可带 `showIf`），界面自动生成控制项。不改渲染器本身。背景要出现在外观的背景清单，加进 `views/panes.tsx` 的 `BG_STYLES`。

**新增一种镜头**（现况，3.5.0）：`director/cameras.ts` 的 `registerCamera()`，只写和 `base` 不同的特征；导演只读特征，**不准在导演或渲染里写 `if (style === '某镜头')`**。字典加 `cut.<id>`。

**新增一种转场的样子**（现况，3.5.0）：`render/transitions.ts` 的 `registerTransition()`；字典加 `trf.<id>`。转场「何时」由导演的段落决定，不在这里改。

**新增一种风格（动态）**（现况）：在 `theme/style.ts` 的 `MOTIONS` 加一笔；需要的话在 `director/recommend.ts` 加推荐条件。新增属于风格的字段时，也要加进 `motionPart` 与 `withSavedMotion`（我的风格），并给默认值让旧数据读得进来。

**新增一个 Folia 风格**（现况，3.3.0）：先读 `docs/FOLIA.md`。在 `src/folia/upstream.json` 加上上游文件（缺的依赖写 shim，不改上游文件），跑 `node scripts/folia-sync.mjs <checkout>`；在 `src/folia/engines/` 写它的执行层（照上游的 runtime，画布与时钟交给 Cadenza），在 `render/engines.ts` 登记，在 `theme/style.ts` 的 `MOTIONS` 加一笔 `engine`。它能拆出来的部分（滤镜、标记）注册成一般特效。

**新增一种外观**（现况）：在 `PRESETS` 加一笔。颜色默认取自封面（`render/palette.ts`）。

**新增主进程能力**：`electron/*.cjs` 加 `ipcMain.handle` → `preload.cjs` 暴露 → `bridge.ts` 加类型。三处缺一不可（目标：由一份契约产生）。

## 5. 代码规范

现况的债：`space/world.ts` 没有类型检查、仍是单一闭包；许多函数过长、区域变量名过短（全项目在 3.0.3 之后做过一次纯格式化，但只改了排版，没有改结构）。这不是风格，是债，不要模仿。

新写与改到的代码：

- 格式由 Prettier 决定（行宽 120，设置在 `.prettierrc.json`）：提交前跑 `npm run format`，`npm run format:check` 必须通过。不手动排版、不为了省行数把叙述挤在一行。
- 不使用 `@ts-nocheck`、`any`（确实需要时用 `unknown` 加收窄）。
- 注释写「为什么」和「不变量」，英文，放在它说明的那一行的上一行。**不要把注释接在代码同一行后面再接代码**——曾有一行缓存检查被行内注释吃掉，造成每帧泄漏。
- 每帧执行的路径不配置对象（重用临时向量）、不查 DOM 版面、不做射线检测（需要时节流到每秒几次）。
- 任何「创建」都要有对应的「释放」：纹理、材质、几何、事件监听、计时器、音频节点。长时间执行的东西加上限（LRU）。
- 数值有单位与来源：魔术数字抽成具名常量并注明意义（秒、公尺、NDC…）。
- 动态用弹簧或有明确曲线的补间，不用线性、不用写死的 `setTimeout` 串。
- 时间一律以歌曲时间或节拍为准，不以帧数为准。

## 6. 测试流程

每次改动至少：

```
npm run format
npx tsc --noEmit -p .
npx vitest run
npm run build:app
```

依改到的地方加做：

| 改到 | 加做 |
|---|---|
| 导演、渲染 | `npm run test:render`（对照画面） |
| 经典界面 | `npm run test:desktop` |
| 空间界面 | `npm run test:space <截图文件夹>`（约 5 分钟），跑完**打开截图看** |
| Folia | `docs/TESTING.md` 的 Folia 对照，数字更新到该文档 |
| 主进程、Hi-Fi | 只能在 Windows 实机确认，汇报时明说 |

各套测试的内容、门槛与做法在 `docs/TESTING.md`。

空间测试（`tests/space.cjs`）的做法：用 Playwright＋SwiftShader 开 `dist-app/index.html`，注入假的 `window.cadenzaDesktop` 与 `cadenzaLib`，用 `window.__cad` 的钩子（`go`、`stand`、`look`、`fakeNow`、`fakeBeats`、`hits`）摆位置与假歌曲。它检查：各房间、空中歌词与字幕、进度条拖动、交互距离、设置卡、播放列、小窗的可点区域、30 秒堆积大小、页面无错误。新增空间功能时在这里加一段检查。

内存：`test:space` 会量 30 秒的堆积大小（差距须小于 1.5 MB）；经典界面的每帧逻辑改动后也要另外量一次。

**汇报时必须区分**：「测过且通过」「只改了逻辑、没有验证」「这个环境无法验证（实体显卡、声音、Windows 窗口行为）」。不把没验证的写成已完成。

修改既有测试的门槛或断言时，在测试里注明哪个版本、为什么改。

## 7. 发布流程

1. 版本号：`package.json` 与 `package-lock.json`。
2. `docs/RELEASE.md` 最上面加一段，写给用户看：改了什么、为什么，不写实现细节。
3. 提交、推到 `space-mode`（预览建置），再快转推到 `main`（`git push origin space-mode:main`）。`main` 上的 `release` 工作流会建置 Windows 安装包与便携版并发布；版本号没变不会发布。
4. 等工作流完成（GitHub 一律用 REST：`gh api`），把发布页链接汇报给用户。细节与指令在 `docs/MAINTENANCE.md`。
5. 汇报优先用简体中文：做了什么、测了什么（分清通过／没验证／无法验证）、还剩什么。

## 8. 界面文案（现况：词汇表在 `docs/COPY.md`）

- 主要画面不出现技术词：扫描、分析、解码、推理、缓存、采样率、位深、引擎名称、API 名称。这些只在「高级」与「信息」弹层出现。
- 一个概念只有一个名字，六种语言各一个。先查词汇表。
- 需求描述里的临时称呼（例如「小窗置顶」「节能模式」「空间模式」「圣堂」）不能直接当产品名称使用，要经过命名。
- 按钮是动词；说明一句话、不超过 30 个中文字；不解释实现，只说对用户的结果。
- 进行中的背景工作不显示计数与进度条，除非用户主动打开查看。

## 9. 设计语言（现况：`docs/DESIGN.md` 第二版「舞台」，3.1.0 起）

写任何画面之前先读 `docs/DESIGN.md`。它回答四个问题（东西属于歌还是属于音乐库、颜色从哪来、跟着什么动、一般人需不需要看到），并列出所有 token 与积木。

当初三个方向：A「舞台」（采用）、B「书页」（未采用，留作参考；用户口中的「方案 B」）、C「节线」（用于专辑页）。B 的完整规格与原型位置在 `docs/DESIGN.md` 第 9 节；做浅色、阅读感重于舞台感的页面时从那里取材。

硬规则（`tests/unit/arch.test.ts` 强制一部分）：

- 正在播放的歌是舞台（`views/NowPlaying.tsx`＋引擎的画面）；音乐库等页面在同一张纸上（`Shell.tsx` 的 `<main>`）；播放列在两者之下都是同一条。不新增第三种地方。
- 纸与舞台的进退是一个弹簧进度（`layers.ts` 的 `applyNp`）：只用 transform 与 opacity，不用 clip-path，不在每帧读版面。
- 颜色来自正在播放的歌：外壳把封面的色相写成 `--song-h`／`--song-c`，token 由它算出纸、强调色。组件不写死颜色（顶列例外：它永远在深色的舞台底上）。
- 选中用反白（`--pick`／`--on-pick`），不用彩色；`--accent` 只表示「这是正在播放的歌」。
- 组件样式不写字面的圆角与时长，只用 `src/app/styles/tokens.css` 的 token。按钮都是胶囊。
- 离场比进场短；可被打断的动态用弹簧。

还是旧版面的部分（歌曲列表、详细页、海报墙、设置页、弹窗）改到时照 `docs/DESIGN.md` 重做，不照旧样子修补。

## 10. 已知的债与不要重蹈的坑

- `space/world.ts`：仍然很大、没有完整类型（声音、歌词、镜头、后制已拆出）。要改它，先在这份文档第 3 节的结构里找到它将来的位置，照那个边界写。
- `src/folia/vendor/` 是同步脚本产生的，不手改；要改上游的行为写 shim 或在 `upstream.json` 加注明原因的修补。
- 对照 Folia 时，两边都要固定乱数；只比一边的截图不算数。
- 云端容器没有显卡、磁盘有配额：性能只看相对变化；浏览器莫名崩溃先查磁盘（`docs/MAINTENANCE.md`）。
- Electron 的拖动区（`app-region: drag`）不看 z-index：盖在上面的按钮仍会被下面的拖动区吃掉点击。拖动区只放在没有任何按钮重叠的矩形上。
- Hi-Fi 播放核心独占设备：切回标准输出时要明确 `release`，否则标准输出会静音到它自己放手为止。
- 画到 WebGL 的 canvas 来源图片必须 `crossOrigin='anonymous'`，否则每帧丢 SecurityError。
- 软件绘图（测试环境）下看不出性能问题；性能结论只能来自实机。
