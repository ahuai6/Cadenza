# Cadenza

Windows 桌面音乐播放器（Electron + React + TypeScript）。它不是「一个特效加一个播放器」，而是几个同样重要、彼此咬合的部分：

| 部分 | 做什么 | 主要位置 |
| --- | --- | --- |
| 音乐库与播放 | 扫描资料夹、标签与封面、歌单与收藏、播放伫列；一般输出与高保真输出（Rust 音讯程式）、音量平衡 | `electron/`、`native/cadenza-audio`、`src/app/playback` |
| 节奏 | 读出每首歌的拍点、重音、段落（神经网路或讯号分析），存成快取；全专案「跟着音乐动」的唯一来源 | `src/rhythm`、`electron/infer*.cjs` |
| 歌词 | 各种格式解析（LRC、逐字、TTML、和声、翻译、读音）、分词、线上取得与写回档案 | `src/lyrics`、`src/text` |
| 特效歌词 | 导演依节奏排版、运镜、转场，渲染器与特效外挂画出来；Folia 的风格与背景（商籁、凝彩、五种背景）也接在这里；可汇出影片 | `src/director`、`src/render`、`src/folia`、`src/engine` |
| 正在播放页 | 封面、逐字上浮的歌词清单、等待的三点；与特效歌词无缝切换 | `src/app/views/NowPlaying.tsx`、`src/app/ui/NpLyrics.tsx` |
| 歌词工坊 | 校时、分词、风格调整，制作与修改特效歌词 | `src/app/views/workshop`、`src/app/workshop` |
| 两种介面 | 经典介面（`src/app/views`）与空间介面（`src/app/space`：可走动的展馆、空中歌词、收音机、聆听室六声道），共用同一套逻辑、指令登记表与设定纲要 | `src/app` |

它们互相依赖：节奏同时驱动特效歌词、正在播放页、专辑线的节奏环与空间里的光和声音；歌词模型同时供给播放列、正在播放页、特效歌词与空间；播放器的一个状态同时被两种介面读取。改其中一处，先想它还被谁用。

**动手之前先读 `.claude/skills/cadenza/SKILL.md`**：分层规则、新增功能的固定流程、测试与发布流程都在那里。它是这个专案的开发范式，不是参考资料。

文件地图在 `docs/README.md`（接手时照它的顺序读）；目前的方向、接下来的工作与使用者已决定的事在 `docs/DIRECTION.md`。

最常用的指令：

```
npx tsc --noEmit -p .     # 型别检查（必过）
npx vitest run            # 单元测试（必过）
npm run build:app         # 产生 dist-app（截图测试与桌面版都用它）
```

不可违反的几件事：

- 严格遵守平台授权与 DRM，不使用破解或规避会员限制的方式。
- 不提交任何商业歌词、音乐档或使用者资料；测试用自己写的假资料。
- 介面上的每个字都经过 `docs/COPY.md` 的词汇表，不直接使用需求描述里的临时名称。
- 回报给使用者一律用繁体中文；文件（`docs/`、`README.md`、这份档案、开发范式）一律用简体中文；程式码注解用英文。
- 提交讯息与程式码里不写模型名称。
