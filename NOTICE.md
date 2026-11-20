# 授权与第三方声明

Cadenza 以 **GNU Affero General Public License v3.0**（AGPL-3.0-only）发布，全文见 [`LICENSE`](LICENSE)。

你可以自由使用、修改和再发布本程式。再发布（包括修改后的版本），或透过网路向他人提供服务时，必须以同样的授权公开对应的完整原始码，并保留这些声明。

## 移植自 Folia 的程式码

`src/rhythm/neural/` 中的神经网路节奏辨识引擎移植自 [Folia](https://github.com/chthollyphile/folia-major)（chthollyphile 及其贡献者，AGPL-3.0）。

- **原样移植**：`src/rhythm/neural/wgsl/` 下的 WebGPU 推理执行环境与 WGSL 核心，对应 Folia 的 `src/services/analysis/beatThisWgsl/` 和 `htdemucsWgsl/`。
- **改写移植**：
  - 梅尔频谱、分块与拼接、峰值挑选；
  - 每拍重音、律动门槛、「感受到的拍」判断；
  - 鼓声分离后的鼓点挑选与无鼓判断。

  这些部分对应 Folia 的 `beatThis.ts`、`beatAccents.ts`、`drumStem.ts`、`drumHits.ts`、`stemRange.ts`。演算法与参数维持原样，只改成 Cadenza 的模组结构与统一接口。

另外，`src/text/segment/` 中的歌词分词器（icu-folia）以及产生分词资料的 `scripts/segmentData.mjs`，移植自 Folia 的 `src/utils/lyrics/icuFolia/` 和 `dev/icuFolia/icuFoliaDataPlugin.mjs`，演算法维持原样：
- 用浏览器内建的 ICU 断词；
- 中文改用 jieba（词典加 HMM），并把助词接回前一个词；
- 日文改用 BudouX 切成文节。

每个移植档案的开头都注明了来源档案。

## 分词资料与函式库

| 项目 | 用途 | 授权 | 上游 |
|---|---|---|---|
| `data/jieba/`（`dict.txt`、`prob_*.py`） | 中文词典与 HMM 表，打包时转成分词资料 | MIT（见 `data/jieba/LICENSE`） | https://github.com/fxsjy/jieba |
| BudouX | 日文文节切分 | Apache-2.0 | https://github.com/google/budoux |
| opencc-js | 只在建置时用来产生繁转简字表 | Apache-2.0 | https://github.com/nk2028/opencc-js |

## 标签写入

- **node-taglib-sharp**（LGPL-2.1-or-later，<https://github.com/benrr101/node-taglib-sharp>）：把编辑过的歌词写入歌曲标签（MP3 的 USLT、FLAC／Ogg 的 Vorbis 注解、M4A 的 ©lyr）。以未修改的 npm 套件形式独立随附于 `node_modules`，可自行替换为其他版本。

## 字体

所有随程式附带的字体皆为 SIL Open Font License 1.1（经由 Fontsource 套件取得），授权允许随软体散布。清单见 `scripts/fonts.mjs`。

## 模型权重（不在 git 中，打包时下载并以 SHA-256 校验）

| 档案 | 模型 | 授权 | 上游 |
|---|---|---|---|
| `beat_this-wgsl.bin` | Beat This!（final0，ISMIR 2024） | MIT，Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria | https://github.com/CPJKU/beat_this |
| `htdemucs-wgsl.bin` | HTDemucs（四声部） | MIT，Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/facebookresearch/demucs |

这两个档案是 Folia 从上游权重汇出的 WebGPU 格式。MIT 授权全文见 [`licenses/`](licenses)。

### 本机加速模型（使用者在设定中按下载才取得，不随安装档散布）

| 档案 | 模型 | 授权 | ONNX 汇出 |
|---|---|---|---|
| `beat_this.onnx` | Beat This!（final0） | MIT，Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria | https://huggingface.co/musetric/beat-this-onnx（MIT） |
| `htdemucs.onnx` | HTDemucs（四声部，FP16 权重） | MIT，Copyright (c) Meta Platforms, Inc. and affiliates. | https://huggingface.co/StemSplitio/htdemucs-onnx（MIT） |

执行环境 [ONNX Runtime](https://github.com/microsoft/onnxruntime)（`onnxruntime-node`，MIT，Copyright (c) Microsoft Corporation）随桌面版附带，Windows 版包含 DirectML（MIT，Copyright (c) Microsoft Corporation）。
