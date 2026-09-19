---
name: write-complete-math-article
description: 从已接纳事实总稿制作派生完整论文，独立全文审核并有界修订；目标完成或用户要求完整成文时使用。
---

通过符号链接安装时，先解析本 SKILL.md 的真实路径。相对资源依此真实路径读取；套装 tools/、runtime/、vendor/ 位于实际 skills/ 的上一级。

# 完整论文

读取 [研究产物](../run-math/references/research-artifacts.md) 和 [轮次合同](../shared/ROUND-WORKFLOW.md)。automatic 仅用于 proof，且必须接受与当前有效事实版本一致的 completionEvidence；explore 仅允许 manual；manual 可以制作诚实标注开放边界的进展文章。

冻结事实总稿、原始证据、有效结论索引、当前论文与编辑欠账。独立写作者以事实总稿为数学来源，把定义、条件和证明链写全，保存 paper/<target>/complete-candidates/<id>/article.md、修订摘要、输入 SHA-256 与事务状态。

交 review-math-article 的 whole-article scope 独立审核。pass 且绑定准确时，在目标文章锁内复核输入，保存不可变 reviewed-versions、恢复快照和 manifest，更新派生论文入口、修订日志和编辑欠账。全部核对后标 promoted；失败恢复论文入口并标 promotion_failed。事实总稿和地图保持由事实事务管理，论文不是下一轮新的事实基线。

rendering_gap 读取 [修订边界](references/repair-loop.md)，最多三轮依赖闭包修订，每次重新审核准确全文。source_math_gap 或需要新数学判断时停止提升，按轮次合同保存失效/疑点与依赖、撤销错误完成声明并交回研究。预算耗尽不追加数学派发。

输出 promoted/promotion_failed/stale_input/article_busy/needs_math_research/review_failed 及候选、报告、事务路径。论文制作失败与数学目标状态分开报告。
