# 界面（`src/app`）

经典界面（`views/`）与空间界面（`space/`）共用同一套逻辑、指令登记表与设置纲要。总览在 `docs/ARCHITECTURE.md`，视觉规则在 `docs/DESIGN.md`，空间的设计在 `docs/SPACE.md`。

## 合约与分层

字体菜单的名称预览是预先烘焙的图（`src/app/ui/font-previews/`，每种语言一张 WebP 加位置表，`npm run fonts:previews` 重新生成），以遮罩显示、跟随文字颜色；打开菜单不加载任何字体。

视觉语言见 `docs/DESIGN.md`。所有组件只读 `styles/tokens.css` 的变量（四级圆角、表面、动态曲线），架构测试会挡下写死的圆角与时长。共用的交互组件都在 `ui/kit.tsx`：
- `Dropdown`：自绘下拉，取代所有原生 `<select>`；
- `ContextMenu`：右键菜单，支持二级菜单；
- `Turn`：换页与换区块时，先淡出旧的、再淡入新的；
- `usePresence`：让会开关的东西都有离场动画。

离场中的画面仍会重绘，因此组件要用传入的数据，不要假设全域状态仍在。字体菜单在 `ui/fonts.tsx`，界面字体在 `uifont.ts`。特效歌词的画面比例（`settings.fxAspect`）由 `playback/visual.ts` 的 `setFxAspect` 统一套用到场景、画面框与导出。

界面是可以整个替换的一层。它和引擎之间的合约是：
- **只引用** `src/engine/index.ts`、`core`、`theme`、`i18n`（由架构测试把关）。
- **设置**：经由 `app/engineConfig.ts` → `configure()`。
- **视觉参数**：一律用 `src/app/styles/tokens.css` 的设计变量（颜色、圆角、时长、缓动、阴影），组件里不写死数值。
- **测试钩子**：`data-test` 属性和 `window.__cadenza`（由 `actions/boot.ts` 挂上）。新界面要保留同名的钩子，桌面端到端测试才能沿用。

界面内部分成两半，重做时只换第二半：

| 留下的（逻辑） | 内容 |
|---|---|
| `bridge.ts` | 与桌面主行程的类型化接口（音乐库、设置、窗口、Hi-Fi） |
| `state.ts` | 界面状态（页面、图层、弹窗、音乐库、设置）的 store |
| `playback/` | `coordinator.ts` 拥有队列和输出生命周期；`player.ts` 接上输出、队列与音量；`projection.ts` 是界面读取的播放状态；`visual.ts` 安排场景；`song-data.ts`、`mv.ts`、`lyric-edit.ts` 处理绑定在歌曲上的数据、MV 与歌词修改；`outputs.ts` 装配 `pcm-output.ts` 与 `hifi.ts`；`pcm.ts` 提供工坊与导出的独立完整解码；`stage.ts` 挂载视觉 |
| `ui/rows-window.ts` | 长列表（160 行以上、不在拖动排序）只绘制可见附近的行，上下用留白占位；歌曲列表的每一行只在它的歌曲、位置或状态变化时重画。「显示正在播放的歌曲」会先把列表滚到那一行 |
| `kept.ts` | 用户做出和选择的东西（外观、我的风格、工坊项目、收听选择、上次的队列），由主进程与曲库一起保存（网页版留在浏览器） |
| `actions/` | 启动（`boot`）、快捷键（`bindKeys`）、换页（`go`）、改设置（`setSettings`、`setLang`） |
| `engineConfig.ts` | 用户设置 → `EngineConfig` |
| `layers.ts`、`motion.ts` | 书页播放栏展开与反向收起，艺术图像的坐标插值，正在播放与特效歌词的画面切换 |
| `workshop/project.ts` | 工坊的项目模型 |

| 换掉的（外观） | 内容 |
|---|---|
| `views/` | 各页面组件与其 CSS Modules |
| `ui/` | 组件库（按钮、滑块、菜单、图标…） |
| `styles/` | 设计变量（`tokens.css`）与基底样式 |

逻辑这一半不得引用 `views/` 或 `ui/`，只有入口 `main.tsx` 例外（架构测试把关）。所以新界面只要调用 `actions/`、读 `state.ts`、挂上 `playback/stage.ts` 的画布，就能接上整个播放器。

经典、空间、任务栏与媒体键使用同一套播放命令。按钮用播放意图决定下一次点击的含义，进度使用文件位置，逐字歌词和空间视觉读换算后的歌曲时间。队列选中和排序使用独立的队列项 `key`，重复出现的同一曲目可以分别选择。

普通输出读取 `cadenza://media/<曲库 ID>?rev=<文件版本>`。元数据就绪后，协调器授权将当前元素接入 Web Audio 图并发起 `play()`。播放已确认且 seek、缓冲和上下文状态允许时，适配器才报告运行。暂停、等待数据和调整位置映射到同一快照。选择其他歌曲同步撤销旧输出，释放节点、事件和读取资源。UI 继续消费协调器状态。一个顺序候选可在当前歌曲稳定播放后预读元数据，单曲循环复用当前元素，队列续播由当前音频 EOF 触发。

ALAC 沿用这套普通输出契约，由主进程根据实际编码选择原生 PCM 媒体源。经典与空间的标签编辑保留歌词原始文本。写入完成并回读才刷新当前 Session；播放重启等待该曲目的标签事务，恢复采用协调器最新的位置与意图。

- 设计语言（颜色、字、圆角、动态、积木）见 `docs/DESIGN.md`，数值只在 `styles/tokens.css`。
- 组件样式用 CSS Modules，类名不会互相覆盖。
- 界面转场：每个转场只有一个进度值，由可反向的弹簧驱动，所有部件都从它派生（不可能卡在半途）。
- 图标集在 `ui/icons`（24 格、圆头线条）。

## 功能只定义一次

- **指令登记表**（`app/commands/`）：每个用户动作（播放、加入队列、收藏、加入歌单、编辑信息…）定义一次；经典界面的右键菜单、空间界面的卡片按钮与准星菜单都从这里取。
- **设置纲要**（`app/settings/schema.ts`）：每个设置声明一次；类型、两边的默认值、主进程的默认值档（`npm run gen:settings`）、设置页的字段（`<SettingField k=… />`）都由它产生。
- **字典**（`src/i18n/dict.json`）：六种语言，一行 JSON（`{ langs, dict: { 语言: { 键: 字 } } }`）。用词先过 `docs/COPY.md`。

## 外观与风格页（`views/panes.tsx` 的 `StylePage`，3.5.0）

特效歌词的「外观与风格」与歌词工坊的「外观」用同一页，四个分页（记得上次开的）：

| 分页 | 内容 |
| --- | --- |
| 外观 | 外观与自己的主题（`ThemePane`）、背景与它的参数（`LookPane`，含 MV）、颜色、字体（`TextPane`） |
| 风格 | 内置风格与我的风格（`MotionPane part="tiles"`） |
| 高级 | 〈风格名〉的设置（Folia 风格）、微调、镜头与细项（镜头、转场与转场的样子、闪光、歌词类型、未唱的字、入场与退场、每一个细项旋钮） |
| 特效 | 特效分组；Folia 风格的画面处理 |

镜头与转场的菜单由登记表列出（`cameraPrograms()`、`transitions()`），新增一种不必改这页。

## 正在播放页

`views/NowPlaying.tsx` 与 `ui/NpLyrics.tsx`：封面、逐字上浮的歌词清单、等待时的三个点（从中心淡入撑开、期间随拍点亮与收缩、离场提前半拍放大再缩小）。背景由引擎画（见 `docs/parts/render.md`），设置在正在播放页的设置菜单（`Modals.tsx`）。
