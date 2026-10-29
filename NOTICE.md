# 授權與第三方聲明

Cadenza 以 **GNU Affero General Public License v3.0**（AGPL-3.0-only）發佈，全文見 [`LICENSE`](LICENSE)。

你可以自由使用、修改和再發佈本程式。再發佈（包括修改後的版本），或透過網路向他人提供服務時，必須以同樣的授權公開對應的完整原始碼，並保留這些聲明。

## 移植自 Folia 的程式碼

`src/rhythm/neural/` 中的神經網路節奏辨識引擎移植自 [Folia](https://github.com/chthollyphile/folia-major)（chthollyphile 及其貢獻者，AGPL-3.0）。

- **原樣移植**：`src/rhythm/neural/wgsl/` 下的 WebGPU 推理執行環境與 WGSL 核心，對應 Folia 的 `src/services/analysis/beatThisWgsl/` 和 `htdemucsWgsl/`。
- **改寫移植**：
  - 梅爾頻譜、分塊與拼接、峰值挑選；
  - 每拍重音、律動門檻、「感受到的拍」判斷；
  - 鼓聲分離後的鼓點挑選與無鼓判斷。

  這些部分對應 Folia 的 `beatThis.ts`、`beatAccents.ts`、`drumStem.ts`、`drumHits.ts`、`stemRange.ts`。演算法與參數維持原樣，只改成 Cadenza 的模組結構與統一接口。

每個移植檔案的開頭都註明了來源檔案。

## 模型權重（不在 git 中，打包時下載並以 SHA-256 校驗）

| 檔案 | 模型 | 授權 | 上游 |
|---|---|---|---|
| `beat_this-wgsl.bin` | Beat This!（final0，ISMIR 2024） | MIT，Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria | https://github.com/CPJKU/beat_this |
| `htdemucs-wgsl.bin` | HTDemucs（四聲部） | MIT，Copyright (c) Meta Platforms, Inc. and affiliates. | https://github.com/facebookresearch/demucs |

這兩個檔案是 Folia 從上游權重匯出的 WebGPU 格式。MIT 授權全文見 [`licenses/`](licenses)。
