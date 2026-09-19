---
name: prepare-math-increment
description: 在推理轮结束后准备有证据的数学增量及修正撤回；不维护完整事实文章，不接纳数学。
---

通过符号链接安装时，先解析本 SKILL.md 的真实路径。相对资源依此真实路径读取；套装 tools/、runtime/、vendor/ 位于实际 skills/ 的上一级。

# 准备轮次数学增量

在一轮推理结束后，读取 [轮次合同](../shared/ROUND-WORKFLOW.md) 和冻结基线、全部原始证据及结果处置。整理本轮新增、加强、修正或撤回的准确数学内容，包括完整局部证明、必要条件、认识论状态及对旧结论的依赖影响。

只准备增量，不提前维护完整事实文章。输出 delta.json（edits、rationale）；每项 edit 含 before/after，before 在冻结基线唯一出现，after 写出本项准确数学内容。插入借用相邻段落作锚点；撤回必须列出并处理失去依据的相关表述。apply_delta 只校验锚点与冲突，其结果不是已维护的完整事实文章。

原始证据不足、冲突未决的内容留在候选记录，不能补造证明。结果可以是开放问题、猜想、条件性结论，但必须准确标注，不能用候选充当已证明前提。

在现有结果处置或 round-summary 中定位本轮结果补充、加强、替代或关闭的旧结果/问题，说明适用范围和受影响引用，交文章维护者落实。不同范围不能仅因新结论更强就标成替代；无关联时说明是新主题。不要求额外清单或提前重排全文。

首次材料处置合入本轮唯一 round-summary.md；审核后的 Main 修订在关联 Attempt 的真实过程和增量理由中记录，不改写冻结总结，不另生成研究轮；默认不另写逐任务总结或整篇候选稿。Main 可先集中处理多条意见，形成适合送审的版本后再冻结，不为每次局部编辑建立新 Attempt。保存全部贡献者身份。交调用方直接运行共享 article_flow 的 finish 归档；Codex session 流程由 run-math 编排，不调用 advancing skill。然后按调用方策略交 commit-research 独立审计增量；advancing 默认只归档候选，用户明确请求本次 Commit 才交接。完整事实文章由 Commit 后的 maintain-math-article 维护。
