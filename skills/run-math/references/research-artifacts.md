# 研究产物

按轮事务严格遵循 [轮次合同](../../shared/ROUND-WORKFLOW.md)，命令与回执见 [文章接口](../../shared/ARTICLE-WORKFLOW.md)。

- `facts/workspace.json`：共同版本指针；事实正文与地图路径从这里读取。
- `facts/attempts/<RUN>/`：冻结基线、原始交互、Evidence、轮次候选 delta。
- `facts/reviews/<REQUEST>/`：冻结数学增量、独立增量审计、Commit、articles/ 下维护的完整事实文章与整合核对、地图轮次和发布记录。
- `research/results/<target>/round-<n>/`：完整任务提示与回复、round-summary.md、round.json、policy.json、dispatch/、round-status.json，以及 explore 的 exploration.json。总结每轮一份。
- `research/results/<target>/ACCEPTED_RESULTS.md`：绑定文章与收据的派生结论索引。
- `research/results/<target>/EDITORIAL_DEBT.md`：非承重编辑欠账，含标识、位置、来源和 open/closed。
- `.codex/run-math/<target>/`：state.json、proof-state.json 或 exploration-state.json、policy.json（目标策略）、route-decisions/、invalidations.json。
- `paper/<target>/`：派生论文 article.md、complete-candidates/、reviewed-versions/、REVISION_LOG.md。

原始记录包含完整提示、完整回复、真实对话身份、派发/回收时间和候选状态。用 read_thread 分页读取原文；截断或附件缺失明确标记，不能据此生成可提交候选。所有任务清单在轮总结中有处置与来源定位。

state.json 记录轮次预算、在途任务、heartbeat ID、工作区路径、目标契约、策略来源与运行状态。round-status.json 记录 prepared/review_failed/article_update_pending/article_published_map_pending/published/no_change/failed/interrupted，以及 REQUEST、文章和地图各自收据路径、哈希与来源版本。旧 map_update_pending/publication_pending 仍按实际收据恢复。文章发布并同步事实索引后即可下一轮；article_published_map_pending 是兼容状态名，仅说明该文章尚无匹配地图，不表示研究未完成或已授权建图；只有用户明确启动的地图任务才保留独立待办，不能因该状态自动恢复地图派发。索引同步失败先重建事实索引；数学修订按轮次合同处理。

RouteDecision outcome 在提交/发布后保存实际义务变化、证据和版本；无增量或审核拒绝记录 no_progress，不提前关闭义务。失效按轮次合同处理。文章不会反向裁决新数学，但文章版本及审核收据约束路由索引。

完整论文事务保存候选、输入事实 SHA-256、材料快照、作者和独立审核身份、每次报告与状态。提升时用目标级 article.lock/ 排他锁，复核事实和候选指纹，保存不可变版本与恢复记录，再更新论文入口、日志和欠账。失败恢复论文入口；事实文章始终由 article_flow 管理。旧锁核对所属事务后恢复，不能覆盖活跃事务。

heartbeat 只使用目标 state 保存的 ID；恢复先检查现有在途任务。空检查仅更新运行状态，不写轮次总结或文章。失效、超时或 pending 的具体恢复信息必须保留。

## 原件与派生查看

原文在研究目录首次落盘，finish 冻结副本后以 Attempt 中的哈希绑定原件作为该轮审计依据。日常索引链接冻结版本，不维护多个可编辑数学正文。run-math 启动时把 research_mode 写入状态与策略；explore 按 exploration-routing 记录问题来源和观察。

轮次数学/审核记录保存在 facts/；view_data.py 从这些档案生成派生 JSON 或 Markdown，不另造历史事件。模式状态、派发日志是可恢复运行资料，不属于事实总稿。查看入口见 view-map 和 view-trajectory。
