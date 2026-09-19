# Codex Math 术语来源索引

本索引指向本套装的既有定义和行为合同，不保存第二套术语定义。所有路径相对真实技能文件解析，不依赖作者电脑或研究项目路径。

| 查询主题及常见别名 | 首选来源 |
| --- | --- |
| 本套装是什么、总体设计 | [项目背景](../../../CONTEXT.md)、[设计原则](../../../docs/design.md)、[使用说明](../../../使用说明.md) |
| Main、session、证明任务、对话池、独立审核者、Sol | [轮次合同](../../shared/ROUND-WORKFLOW.md)、[审核入口](../../review-math-article/SKILL.md) |
| setup、自动创建与绑定、模型、thinking、创建时快照、改模型 | [setup-math](../../setup-math/SKILL.md)、[配置合同](../../run-math/references/project-state.md) |
| run、首轮 grilling、继续、范围与目标变化 | [run-math](../../run-math/SKILL.md)、[轮次合同](../../shared/ROUND-WORKFLOW.md) |
| proof、根命题、义务、路线、完成 | [证明路由](../../run-math/references/proof-routing.md)、[研究配置与状态](../../run-math/references/project-state.md) |
| explore、研究意向、自然问题、理解进展、no_change | [探索路由](../../run-math/references/exploration-routing.md)、[轮次合同](../../shared/ROUND-WORKFLOW.md) |
| 研究轮、预算、轮次屏障、补充派发 | [轮次合同](../../shared/ROUND-WORKFLOW.md) |
| sending、等待、heartbeat、120 分钟期限、结果回收与中断 | [派发恢复](../../run-math/references/dispatch-recovery.md)、[run-math](../../run-math/SKILL.md) |
| Attempt、Evidence、候选、增量、原始回复、轮次总结 | [研究产物](../../run-math/references/research-artifacts.md)、[增量准备](../../prepare-math-increment/SKILL.md)、[文章接口](../../shared/ARTICLE-WORKFLOW.md) |
| 数学 Commit、接纳、独立审核、收据、自动与手动 | [接纳入口](../../commit-research/SKILL.md)、[文章接口](../../shared/ARTICLE-WORKFLOW.md)、[轮次合同](../../shared/ROUND-WORKFLOW.md) |
| 事实总稿、文章发布、pending、撤回、更正、派生论文 | [文章接口](../../shared/ARTICLE-WORKFLOW.md)、[文章内容规范](../../shared/ARTICLE-CONTENT.md)、[完整论文](../../write-complete-math-article/SKILL.md) |
| advancing 与 run 的区别、单次研究 | [advancing](../../advancing/SKILL.md)、[run-math](../../run-math/SKILL.md) |
| 共同理解、地图、轨迹、形式化 | [理解结果](../../understand-research/SKILL.md)、[地图](../../view-map/SKILL.md)、[轨迹](../../view-trajectory/SKILL.md)、[形式化](../../formalize-research/SKILL.md) |
| 项目配置、归档路径与状态格式 | [配置合同](../../run-math/references/project-state.md)、[README](../../../README.md) |
| 实现、已验证范围、当前分发 | 相关技能正文及其引用代码；[既有验证报告](../../../verification/report.md)、[真实宿主待核验项](../../../verification/target-host-checklist.md)、[包元数据](../../../package.json)、当前 Git 版本与实际测试结果 |

证据分工：共享合同给权限与时序，入口正文给操作要求，代码与实际运行记录支持实现事实；报告仅覆盖其实际检查版本和范围。本文不把 Skill OS 的三模块、M/R、Kernel、四个原子动作或手动 Commit 规则带入 Codex Math。
