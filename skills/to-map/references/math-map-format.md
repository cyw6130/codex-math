# 数学地图格式

基于当前生产 V5.2.1 使用的 `cmath-gamma.math-map-semantics/v3`。严格状态合同名为 `cmath.math-map-state/v3`，但严格 JSON 内没有 `schema` 字段。

## 严格状态（默认交付）

顶层恰有四个数组：

```json
{
  "entries": [],
  "inferences": [],
  "negationPairs": [],
  "b0ClaimEntryIds": []
}
```

这是形状示例；实际提取必须填入来源支持的内容。

| 对象 | 恰有的字段 | 合法类型 |
| --- | --- | --- |
| Fact | `id`, `entryClass`, `factKind`, `title`, `statement` | `entryClass: "fact"`；`factKind: "definition" / "algorithm" / "calculation"` |
| Claim | `id`, `entryClass`, `claimKind`, `title`, `statement` | `entryClass: "claim"`；`claimKind: "lemma" / "proposition" / "theorem"` |
| Inference | `id`, `operationKind`, `premises`, `conclusion`, `argument` | `operationKind: "proof" / "organization"` |
| NegationPair | `claimEntryIds` | 恰好两个不同 Claim ID |

字符串非空、无首尾空白。Entry 与 Inference 共用唯一 ID 空间；前提、结论与 B0 均引用当前地图中的 Entry。Inference 的 premises 是至少一个 ID 的无重复联合依赖集合，conclusion 是一个 ID。JSON 中 LaTeX 反斜杠须转义，数学表达式用成对的 `$...$` 或 `$$...$$`。

## 数学含义

- **Fact** 描述定义、算法过程或具体计算内容，天然可用。算法的正确性、一般性质等需要证明的断言仍是 Claim。局部假设写入相应陈述的适用条件；不要将猜想或待证假设伪装成天然可用的 Fact。
- **Claim kind** 是当前文章地图中的叙事角色：lemma 为局部工具，proposition 为独立而非核心结果，theorem 为核心内容。它不表示证明状态；Corollary、Conjecture、Problem 不是额外 kind。未决命题保持准确的待证陈述；不能转成命题的开放式提问记在检查说明中，不硬造 Claim。
- **proof** 的结论必须是 Claim。同一结论的多个 proof 是替代路径，每条内部的 premises 则需要联合满足。保留来源实际提供的中间作用，不把标题、相邻章节或文献提及变成逻辑依赖。
- **organization** 的结论必须是 `Fact(definition)`，表达有依据的概念形成；不影响 Closure。一般主题关联、流程先后和算法调用不是该类型的通用边。无法表示的关系保留在检查说明，不增造类型。
- **B0** 只收来源范围外、被可靠调用且当前范围内未独立重证的 Claim。综述或讲义中直接采用的已知结果可属于 B0；当前范围内只宣布而未证明的新结果、猜想和提取遗漏不能据此加入 B0。背景提及本身不够。是否有作者原创性不决定 B0，所选来源范围内是否实际证明才决定边界。
- 若去掉一个 B0 种子后仍能由其余 B0、Fact 和 proof 建立该 Claim，它不能留在 B0。**并非只要有指向 B0 的 proof 就非法**：循环关系可能仍依赖该种子，按权威校验结果判断。
- **NegationPair** 仅连接来源分别陈述、在相同条件与量词下恰为逻辑否定的两个 Claim。每个 Claim 至多属于一对；无独立 ID。缺少其中一端就不补造，使用空数组。
- **派生状态** 由 `deriveMathState` 计算：全部 Fact 与 B0 提供初始可用项，proof 闭包得到 established；其否定建立而自身未建立时为 refuted；其余为 open。proof 循环可以合法但不能无依据地自举；organization 循环非法。否定对两端同时建立则地图非法。

提取的 proof 表示来源给出的论证，不意味着独立认证原文证明。地图的 open 也不自动意味着该数学问题尚未解决；可能只是所选范围没有证明，或提取不完整，须对照原文说明。

严格状态不含来源、标题层级、主目标、状态、审核或路线字段。对象定位与检查结论保存在检查说明中；不手写 `claimStates`、`established`、`confidence` 等额外字段。

## Project View（仅用户要求时）

旧 benchmark / viewer 接受 `cmath.project-view-model/v0.1`。将严格地图的四字段原样保留，增加 `schema: "cmath.project-view-model/v0.1"` 和 `projectTitle`。Entry / Inference 可增加 `sourcePath`、`sourceReference` 等展示或溯源字段。

`mainTargetEntryId` 可省略。只有文章确有一个明确主目标时才设置，并引用实际 Entry；多主线文章的主题结构放在检查说明中，不添加不兼容的 `mainTargetEntryIds`，也不为适配 viewer 合成总定理。

调用严格校验器前剥离这些包装字段。即使 Project View 合法，也未必适合旧轨迹生成器；轨迹适用性不作为文章提取验收条件。

## 校验

使用现有权威模块导出的 `deriveMathState(M)`；它检查字段、类型、引用、B0、否定关系与 Closure，不裁定来源忠实性。环境定位见 [local-tools.md](local-tools.md)。

校验严格输出的最小命令（将两个参数替换为实际路径）：

```sh
node -e 'const fs = require("node:fs"); const {deriveMathState} = require(process.argv[1]); const map = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); console.log(JSON.stringify(deriveMathState(map), null, 2));' /absolute/path/to/semantics/index.js /absolute/path/to/article.math-map.json
```

Project View 先复用现有 `generator/project_view.py` 的 `project()`，再把严格状态交给语义模块。不要把 `generator/validate_map.py` 的轨迹生成检查当作通用格式检查，也不要复制一套 Closure 算法来替代缺失的权威模块。
