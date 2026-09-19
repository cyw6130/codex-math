---
name: commit-research
description: 对一轮自动选定或用户手动选定的文章增量执行独立数学审核、接纳，并交接事实总稿维护。
---

通过符号链接安装时，先解析本 SKILL.md 的真实路径。相对资源依此真实路径读取；套装 tools/、runtime/、vendor/ 位于实际 skills/ 的上一级。

# 轮末增量 Commit 与审计

读取 [轮次合同](../shared/ROUND-WORKFLOW.md) 与 [文章接口](../shared/ARTICLE-WORKFLOW.md)。Codex session 模式的默认时机是一个推理轮次完成、明确关闭派发且全部完整结果回收之后，不逐回复提交，也不等文章或地图先完成。

独立 advancing 任务在实际任务完成、证据归档且用户明确要求 Commit/接纳本次结果后进入，不要求 Codex session 派发或 closure。自动范围、手动范围及冻结材料按共享合同执行；本 skill 负责把准备好的请求交审核并接纳，不维护全文。

调用 review-math-article 的 fact-increment，独立审计增量的数学正确性、条件、状态及对既有结论的影响。取得真实原生回执后 accept，保存 Commit；审计不通过不接纳。自动 Commit 是研究事实接纳，不执行 Git 操作。

接纳后交 maintain-math-article：维护并发布完整事实文章，不自动建图；研究批次结束后交 understand-research。已 pending 时先区分整合/提取问题与数学问题：前者恢复同一请求，后者交 Main 走文章接口的关联修订和更正 Commit。无数学增量只归档；失败/中断轮不提交部分结果。审核意见和证据先交 Main，局部修订后优先交原 Sol 定向复核；修订 REQUEST 关联原请求，只有另派 Codex session 实质研究才计新轮。
