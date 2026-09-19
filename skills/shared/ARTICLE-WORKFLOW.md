# 文章优先的后续接口

本合同适用于 `workspace.json` 的 schema 为 `math-workspace/v1` 的工作区。工作区的状态与 revision 须符合本合同。只有文章和数学地图是数学产物；workspace、attempts、reviews 只是指针和真实治理记录。

工作区根 ROOT 在本项目为 `facts/`。脚本路径从 ROOT/workspace.json 的 runtime 相对 ROOT 解析，当前为 ROOT/.workflow/article_flow.py。下文 FLOW 指该绝对路径，ROOT 也传绝对路径。先运行 `python3 FLOW ROOT status`；读 workspace 指定的准确文章与地图，不靠旧链接猜版本。状态含 pending 时先恢复文章维护与文章发布；地图滞后用 map_revision 与 revision 区分，不占用 pending。旧运行尚用共同发布指针时按旧记录恢复，或在脚本升级后对已核对的 v2 文章调用 publish-article；发现数学问题按下文“关联修订”暂停原发布并接纳更正，不能让 pending 挡住修复。

## 规则归属与审阅材料

本文件统一规定审计调用、整合分级、收据与恢复接口；[轮次合同](ROUND-WORKFLOW.md) 统一规定轮次边界、预算与自动提交授权；[数学审核标准](../review-math-article/references/fact-review.md) 统一规定内容检查。[文章内容规范](ARTICLE-CONTENT.md) 统一规定首次汇编、增量维护和审核复用；各 skill 只描述职责与交接，不另设门槛。

新增量包自动冻结 review-focus.json：逐项 before/after、理由、证据定位及旧文哈希；整合包另列接纳增量落入全文后的额外差异、章节索引与全文路径。它们只是阅读索引，不能替代原始证据或宣称审核通过。先读本轮变更及必要证据，再检查受影响的定义、依赖和相关旧文；有冲突、撤回、跨节影响或不确定性时扩大范围。已有审核引用须核实哈希与适用范围；无有效依据不默认旧结论已经审核。全量冻结旧文、增量和证据仍随包保留。

## 归档与推理

`python3 FLOW ROOT start RUN --objective TEXT --identity NATIVE_THREAD_ID --grilling GRILLING.md [--source FILE ...]`

保存用户已明确的任务交互原文；脚本自动冻结当前文章和地图，额外来源逐个传入。归档路径 ROOT/attempts/RUN/。执行者保存真实可见交互和原生工具输出，不用总结代替、不编造隐藏推理。数学过程、失败、无增量、证据均保留。

`python3 FLOW ROOT finish RUN --outcome candidate --transcript TRANSCRIPT.md --delta DELTA.json --evidence FILE [--evidence FILE ...]`

delta 仅含 `edits` 和 `rationale`：每项 edit 恰有 `before`、`after`，before 非空且在基准文章中恰出现一次。after 是完整数学正文，可新增、修正或删除内容；通过替换唯一相邻段落实现插入。禁止上传 canonical M 代替文章增量。结果仍未接纳。

其他 outcome：`no_change`、`failed`、`interrupted`，不传 delta；Evidence 可选。finish 重试必须相同输入。原文变化时拒绝 candidate/no_change；中断如实归档，另起新任务，不覆盖旧 ID。

## 选定结果与独立 Commit

手动模式由用户选定候选；按轮自动模式依 [轮次合同](ROUND-WORKFLOW.md) 的既有授权选定本轮非空候选，使用 round_flow.py prepare。单次 advancing 默认只归档候选；仅用户明确要求 Commit/接纳本次结果时走下述普通 prepare 路径。仅选择研究范围不构成接纳请求，不继承项目一般自动提交策略，也不伪造 Codex session 轮次或借用 per_round_auto。手动准备命令：

`python3 FLOW ROOT prepare REQUEST RUN_A [RUN_B ...] --identity AUTHOR_ID [--exclude-reviewer CONTRIBUTOR_ID ...]`

新请求 schema=research-increment-packet/v2。脚本校验增量锚点与冲突，保存 ROOT/reviews/REQUEST/packet.json、冻结旧文与 Attempt/Evidence；此时不生成维护后的 paper.md。冲突先交 Main 建立修订增量，确需证明 session 新研究才另计轮；自动模式沿用目标范围授权，手动模式由用户选择。增量准备和审计不维护正式文章。范围外结果不能夹带。按轮模式通常只有一个合并 Attempt；把全部 证明 session 作者与候选写作者传入 --exclude-reviewer。

必须使用真实独立原生 reviewer，默认 Sol/medium。按上文材料入口和数学审核标准交给 reviewer。审查者不能参与本次候选的数学写作；若本次还要重新判断某项旧结论，其作者也应回避，由 Main 用 --exclude-reviewer 补充。历史上写过无关或本次仅复用的已审内容，不自动失去审核资格。

Reviewer 产出 verdict JSON（reviewer_identity 使用真实原生 thread ID）：

```
{
  "packet_sha256": "精确 packet 文件哈希",
  "reviewer_identity": "真实独立身份",
  "verdict": "accept 或 reject",
  "accepted_attempts": ["逐个选定的 RUN ID，顺序一致"],
  "increment": "accept 或 reject",
  "findings": "真实理由、逐项意见和疑点"
}
```

Reviewer 最后必须以纯 JSON 返回以下回执，使用真实文件哈希：

```
{"packet_sha256":"...", "verdicts_path":"/absolute/verdict.json", "verdicts_sha256":"...", "review_scope":"mathematical-correctness", "accepted_count":1, "rejected_count":0}
```

accepted_count/rejected_count 为实际逐项增量意见的数量；这里的 1 仅示意，不能照抄。调用方从真实宿主会话定位 rollout，运行 `python3 FLOW ROOT import-review REQUEST --rollout HOST_ROLLOUT.jsonl --verdict VERDICT.json --agent-path ACTUAL_AGENT_PATH`；默认核 Sol/medium，显式换模型时传 --model/--effort。原生记录解析兼容同一 turn 完全相同的重复 turn_context payload；只合并读取，不修改原始日志，内容冲突仍拒绝。核最新完成 turn（不能越过更新的未完成任务）、真实 subagent 身份、模型及 final 中的 packet/verdict 哈希，冻结原始 rollout 和 native-receipt.json。不接受自写 native-review.txt 冒充原生回执，不伪造 rollout。

然后运行 `python3 FLOW ROOT accept REQUEST --verdict VERDICT.json`。机器绑定证明审核输出来自所记录的会话，不代表机器自己证明数学正确。

成功写 research-increment-receipt/v2 的 commit.json，进入 article_update_pending。接纳对象是冻结数学增量，收据不包含尚未维护的全文哈希。workspace.pending 暂停无关新轮，允许显式关联的修复，事实文章阅读指针仍保留上次已发布文章；地图有自己的来源版本。

Sol 接续按 [轮次合同的分工](ROUND-WORKFLOW.md#maincodex-session-与-sol-的分工)：完成通知或短等待后立即处理，不等 15 分钟 heartbeat；格式问题先由 Main 修复工具或明确回执，不要求重做已完成的数学审核。

## Commit 后维护完整事实文章

maintain-math-article 按文章内容规范的增量维护与审核复用要求，根据旧完整文章和已接纳增量维护新的完整正文，更新定义、证明、相关依赖、撤回和章节连接；不能只累积增量片段。允许表达和组织调整，不能改变已接纳条件、证明状态或补充新数学判断。

`python3 FLOW ROOT article-packet REQUEST ARTICLE_ROUND --paper COMPLETE_ARTICLE.md --identity WRITER_ID`

冻结在 REQUEST/articles/ARTICLE_ROUND/，包括候选完整文章、Commit、旧文与接纳增量及证据。Main 先判断实际整合影响：能够确认忠实完整时采用下述维护核对；需要第二视角或存在疑点时采用独立整合审核。独立 reviewer 回避本次增量和整合的写作者，按 review-math-article 的 article-integration 范围核对整合完整性和忠实性；不重新证明已审计的数学。

文章整合 verdict JSON：packet_sha256、reviewer_identity、verdict=accepted-for-article（否则 reject）、complete=true、faithful=true、issues=[]，并提供实际逐项增量落实和旧内容覆盖说明。原生 final 使用与上文相同结构，review_scope=article-integration-fidelity；真实计数按实际核对项填写。

`python3 FLOW ROOT import-review REQUEST --article-round ARTICLE_ROUND --rollout HOST_ROLLOUT.jsonl --verdict VERDICT.json --agent-path ACTUAL_AGENT_PATH`

`python3 FLOW ROOT update-article REQUEST ARTICLE_ROUND --verdict VERDICT.json`

### Main 判断整合是否需要独立核对

Main 根据旧文、已接纳增量和新文判断数学含义及覆盖是否保持。已审计的替换或撤回、措辞调整、标题与段落整理、引用修正，均可由 Main 直接维护核对；不按改字数量、是否移动章节或是否原样插入决定审核。涉及证明重组、约定转换、依赖影响时，Main 判断自己能否可靠核对，需要第二视角或尚有疑点再请 Sol 做定向 article-integration。新增或改变数学结论、条件、证明依据的内容仍先走增量审计与 Commit。

维护者写真实 CHECK.json：schema=article-maintenance-check/v1，classification=editorial-integration，maintainer_identity=WRITER_ID，commit_sha256=准确 commit.json 哈希，paper_sha256=完整新文哈希，complete=true，faithful=true，issues=[]，risk_flags=[]，coverage=实际检查及判断依据，一段简短说明即可。由 Main 保存，不让用户填表，不要求逐句另建清单；不能照填通过。脚本校验文件绑定，不把 Main 的声明当作独立数学证明。旧 classification=simple-insertion 收据继续按原样插入核验。

`python3 FLOW ROOT article-packet REQUEST ARTICLE_ROUND --paper COMPLETE_ARTICLE.md --identity WRITER_ID --lightweight-check CHECK.json`

`python3 FLOW ROOT update-article REQUEST ARTICLE_ROUND --verdict CHECK.json`

此分支不调用 import-review，不生成独立审核回执；article.json 明确标记维护者核对。此前增量的真实独立数学审核仍强制验证。旧包未写 review_mode 时沿用独立审核。

两条路径通过后 article.json 绑定 Commit、新完整文章与对应核对记录；随后立即运行 `python3 FLOW ROOT publish-article REQUEST`。它重新核对接纳与整合绑定，保存 article-published.json，原子推进 workspace 的文章 revision、paper 和作者，清除该请求 pending，恢复阅读链接。兼容状态名仍为 article_published_map_pending，仅表示文章已发布而尚无匹配地图，不授予建图权限，也不阻塞研究完成。事实索引同步后可以开始下一研究轮；整批结束交 understand-research，地图由用户随后选择。文章已登记但发布中断时重试该命令，不重做 Commit。失败保留候选，使用新的 ARTICLE_ROUND 修正表达后再核对，不重新 Commit；需要新数学判断时交 Main 走下文关联修订；不要把数学修改伪装成编辑整合。

旧 article-commit-packet/v1 的历史请求已在审计前包含完整 paper.md，只按原收据恢复。新 CLI prepare 默认 v2，新自动轮次必须用 codex-math-round/v2；不覆盖旧请求或默默替换既有工作区 runtime。启用新流程前按 setup-math 的升级说明备份并更新工作区脚本和合同；兼容修复可在外部 Codex session 等待期间、持有本地事务锁时更新，旧 archives 和在途派发保持不变。

## 按需文章到地图与投影审核

研究入口与文章维护默认不调用本段流程。主要结果与证明经 understand-research 梳理后，用户选择建图才执行；独立明确的建图请求也可直接执行，不补造理解确认。用 map-packet --current 绑定梳理后最新已发布文章；旧 REQUEST/ROUND 仅用于其原版本的明确任务或恢复。理解记录、主要结果目录和依赖说明是阅读索引，只有已落实到准确文章的内容才能入图。纯编辑整理按已有编辑入口，新数学仍须增量审核和 Commit。


to-map 的唯一正文输入是 article.json 绑定的 REQUEST/articles/ARTICLE_ROUND/paper.md（旧 v1 为 REQUEST/paper.md）。未完成文章维护时 map-packet 会拒绝。输出地图、来源检查、现有权威 deriveMathState 的验证记录。source-check.json 至少绑定 source_sha256，validation.json 绑定 source_sha256、map_sha256、validator 和 errors；保留真实逐项检查及原生验证输出，不补写“通过”。

`python3 FLOW ROOT map-packet REQUEST ROUND --map MAP.json --source-check CHECK.json --validation VALIDATION.json --identity EXTRACTOR_ID`

生成 REQUEST/maps/ROUND/packet.json。map-review 直接接这个文章+地图包，不再要求 derived-projection、accepted canonical M 或 `freeze-projection`。本次地图的提取者及参与修图者不能担任 reviewer；其他参与者由 Main 用 --exclude-reviewer 补充。文章作者可以对照原文审核提取，只要没有参与本次地图制作；若发现原文数学问题，另交 Main 安排独立数学审查。独立审核仅忠实性与覆盖，不重判数学正确性。默认以轻量对照审核变化及受影响部分，具体分类、条件和粒度按 to-map 的 Entry 质量指导。用户理解不替代独立提取核对；合格项用简短理由、适用旧项引用复用，详细报告只展开具体差异与未解决问题，不另写全文数学评审。按 10 格式 + 45 Entry + 45 Inference 评分；保留逐对象评估及遗漏。

新 map-packet 自动附带冻结的 review-focus.json 阅读索引：以最近已发布且审核可核实的地图及其对应文章为比较基础，列出 added、changed、removed、reuse_candidates、related_objects_to_inspect 和 article_diff；previous_review 记录旧包、报告、文章和地图的位置及哈希。地图落后数轮时比较覆盖累计变化，不只看本轮文章增量。没有适用已发布审核时建议 full；旧包保持原样可恢复。索引不判定数学含义，不自动批准复用，也不替代 reviewer 的文章覆盖检查。

verdict JSON：packet_sha256、reviewer_identity、verdict、score、coverageRatio、sourceClean、omissions、distortions、fabrications、unresolved、assessments，以及逐节 source_coverage（源范围、对应对象或未提取理由）。评估项恰好覆盖所有 Entry、Inference、B0 成员、否定对；每项含 kind（entry/inference/b0/negationPair）、id（否定对用零基数组下标字符串）、source_locator（heading、line_start、line_end）、disposition（faithful 或问题类型）和 reason。零问题、全覆盖、100 分才为 accepted-for-projection。完整 assessments/source_coverage 可以由新检查与适用旧审核合并；复用项在 reason 或对应章节说明中记录旧报告路径、哈希、对象/章节及仍适用的依据，source_locator 指向当前文章。可程序化继承这些记录，无须逐轮重写旧理由。报告 summary 说明本次检查和复用范围；未受影响旧内容不重复审核，初次提图或缺少适用审核时才全查，系统性问题按需扩大。

独立地图 reviewer 同样返回纯 JSON 原生回执，review_scope 改为 extraction-fidelity，计数对应最终覆盖的评估项（含有依据的复用）；报告如另列本次新检查数与复用数，须如实区分，不能把继承记录说成逐项重审。运行 import-review 时加 `--round ROUND`，其余真实身份、来源与哈希要求相同。

这里的零问题指影响忠实性、覆盖或条目正确理解与引用的实际缺陷，包括陈述缺少条件/结论、虚设 Definition、研究评论冒充 Claim；不能仅因文字取自原文就忽略它们。合理的可选润色只写在现有 summary/报告正文中，不扣分、不填入上述问题列表，不阻塞发布；不增字段、字数/重复率门槛或审核层。

修图先由 Main 按原文局部处理，必要时调用 to-map，使用新地图 ROUND 保留旧版；原独立 reviewer 优先核对修复及影响，复用仍适用的已审部分。不因提取修订增加研究轮或重新 Commit；仅有可选表达建议可直接发布。原文缺条件或论证时交 Main 走文章更正通道，不在 map-review 改文章。

`python3 FLOW ROOT publish REQUEST ROUND --verdict VERDICT.json`

重新验证该文章、接纳及地图审核绑定后，发布地图。已经 publish-article 的请求只更新 map、map_revision、map_paper 与地图发布收据，不移动文章、不清除另一轮 pending。较旧文章的地图可补上当前滞后的地图；如果当前地图已来自更晚文章，则只归档，不能覆盖。workspace.json 是原子指针；阅读链接中断后用 `links` 恢复。纯地图发布故障重试同一 REQUEST，文章仍可使用；published.json 已写但地图指针尚未更新时仍需恢复。地图审核不是新的数学接纳。旧工作区未调用 publish-article 的历史请求仍支持原共同发布恢复。

## 初始化接续与只读入口

既有文章和地图由用户确认作为工作基线时，可以登记准确文件及真实 review provenance，不重提取、不重证明、不伪造历史。`initialize --paper FILE --map FILE --provenance JSON` 只登记已确认材料，provenance 必须写 paper_sha256、map_sha256、authorization、article_review 的原始报告位置及哈希、map_review 的真实状态。没有独立地图审核时写 not-run，不能伪装100分。现有 workspace 只读恢复，不覆盖。

`trajectory` 校验并列出本接口真实归档；按返回路径读取原始 grilling/transcript/Evidence 展示，绝不从文章构造事件。旧档案单独标明 legacy，不混用修订编号。可视化调用用户选定的 map-view 阅读当前 JSON，不重画前端。

派生论文沿用本项目已有 paper/（单数），按需写作；不另建 papers/。项目迁移时整体复制 facts/，内含运行脚本、合同、相对路径和冻结基线；外部文献/审核原始位置仅是来源线索，其必要原文应另存到归档。

## 只审核或更新当前地图

文章没有新数学提交、只要审核初始化地图或修复提取时，`map-packet` 加 `--current`，以当前文章为准确正文，不需要先做 Commit。仍需 to-map 来源记录、真实语义校验和新的独立地图 reviewer。作者与提取者身份须按实际排除，不能重用本人审核。通过后按同一 publish 命令更新地图审核记录与地图阅读指针，文章 revision 不增长，不生成数学 commit 收据。这条分支保证地图维护不会强迫研究提交。

## 关联修订：Main 优先，Sol 定向复核

适用于未接纳候选或已 Commit、尚未发布的增量。Main 先阅读具体意见和证据；可以局部改写、修正条件、补齐短证明。需要持续推理时由 Main 路由到证明 session，按剩余预算开修复研究轮。调用现有 start 时只多传原 REQUEST：

```bash
python3 FLOW ROOT start REPAIR_ATTEMPT --repair-of REQUEST --objective "实际修订问题" --identity MAIN_ID --grilling CONFIRMED_GOAL --source REVIEW_REPORT
```

工具冻结原候选、来源和已有收据，继承全部贡献者身份，暂停原请求发布，保留原 Commit。ID 由 Main 按现有命名习惯生成。轮次计数依据 Codex session 首次 sending，不依据 Attempt 数量；Main 修订不创建新 round.json。原审核报告即使尚未导入收据，也应作为 --source 保留。中断可用相同参数恢复 start；failed/interrupted/no_change 修订可用新 Attempt 接续同一源请求。

修订 delta 是相对于最近完整发布的 base-paper.md 的**替代净增量**，须包含要保留的原增量和更正，不能只写相对未发布候选的补丁。撤回全部未发布增量时可用 edits=[]，rationale 写明撤回依据，仍须真实 Evidence 和独立审核；普通无增量轮仍不做空 Commit。

用现有 finish 保存实际修改过程、delta 和 Evidence，再 prepare 新 REQUEST；工具自动关联原请求、生成修订差异索引并排除 Main 与该候选的原作者。然后由原 Sol 优先定向复核，以新 REQUEST 导入真实回执、accept。更正 Commit 记录 supersedes，原收据不覆盖；工作区 pending 转到新请求，然后照常维护完整文章、核对整合并 publish-article；返回研究或当前理解会话，不自动建图。连续修订用 --repair-of 最新候选请求；原请求不能重新接纳或发布。

round_flow 恢复原轮时沿修订链返回当前候选或 Commit，不变更原轮 binding；view-trajectory 保留修订来源，并区分本地修订和有真实派发的 Codex session 修复轮。摘要与轮次报告合并展示处理结果，勿逐次重写总结。审核者名称或报告字段不代替真实数学检查。

已经发布的文章需要更正时，以当前准确版本正常 start，明确保留原收据和问题证据，维护失效记录；不要用 --repair-of 回滚已发布基线。Main 的本地更正仍不凭空增加研究轮。


## 同一 Commit 下的文章修订与恢复

### 已发布账本的纯编辑整理

用户要求整理，或按文章内容规范完成批次整理时，使用 `editorial-packet`，不创建空数学 Commit。先确认部署的 runtime 支持以下命令；旧 runtime 必须先按既有升级方式备份和同步，不能把文档当作已实现接口。

`python3 FLOW ROOT editorial-packet EDIT_ID --paper COMPLETE_ARTICLE.md --identity WRITER_ID [--lightweight-check CHECK.json] [--exclude-reviewer CONTRIBUTOR_ID ...]`

该命令冻结当前全文、workspace 与原发布收据（初始化使用 provenance）、候选全文及编辑差异。候选不占用研究 pending；若期间文章版本前进，旧候选不能发布，应基于新文重新整理并使用新 ID。存在未完成文章或数学修复时先恢复原任务。候选修改也使用新 ID，不覆盖已冻结包。

整合分级仍由 Main 按语义影响判断。直接核对使用 CHECK：schema=`article-editorial-check/v1`、maintainer_identity、base_paper_sha256、paper_sha256、complete=true、faithful=true、mathematics_changed=false、issues=[]、risk_flags=[]、coverage=实际整理及保留性核对说明。不使用 commit_sha256，也不伪造新接纳。独立分支使用 review-math-article 的 article-integration；verdict 保留 packet_sha256、reviewer_identity、verdict=accepted-for-article、complete、faithful、issues，另写 mathematics_changed=false 和 coverage。用现有 `import-review EDIT_ID`（无 article-round）导入真实原生记录，review_scope=`article-integration-fidelity`；回避本次整理贡献者，旧数学作者按实际重审范围回避。

`python3 FLOW ROOT publish-editorial EDIT_ID --verdict CHECK_OR_VERDICT.json`

核对准确候选和旧文版本后，写 kind=editorial 的文章发布收据，文章 revision 加一并更新阅读指针，原数学 Commit 与旧文章保持固定；revision 表示文章版本而非研究轮数。地图保留旧版本；理解梳理后用户选择更新时，再使用 `to-map`、`map-packet --current` 和轻量独立地图审核，保持适用 ID 与来源映射。纯编辑不得改变假设、结论或证明依据；发现数学问题转正常更正增量，不签 mathematics_changed=false。发布中断可重试同一候选；已进入编辑版本祖先链的重试只返回当前状态，不能覆盖后续版本。无法核实祖先关系的旧请求安全拒绝，读取其收据确认完成，不重新发布。

### 尚未发布的文章

文章已登记、尚未生成 article-published.json 或旧 published.json 时，Main 可用新的 ARTICLE_ROUND 调用 article-packet 修订措辞、编排和符号说明。新包保留上一文章收据与全部作者名单，并暂停旧地图发布；按原整合分级核对，通过 update-article 接续。旧文章、审核及 receipt.json 保留，article.json 指向最新已核文章。数学 Commit 不变，修订次数不增加研究轮。发现数学内容变化仍走关联数学修订，不能借编辑通道接纳。文章发布后内容固定，地图审核若发现原文数学问题则登记失效、停止受影响推理，并基于当前文章形成新的更正增量；仅提取遗漏或错误不影响有效文章。

重新调用 to-map/map-packet 时使用最新文章；旧地图包不能用于新文章整合版本。中断时重试相同 ARTICLE_ROUND 和准确材料。发布收据已经生成时先恢复发布指针；已发布文章保持固定。

map-packet --current 自动继承工作区记录、对应文章发布档案和初始化 provenance 中已知的作者身份；连续单独更新地图后仍保留。旧初始化来源没有身份时不猜造；作者来源与本次回避名单分开：article_authors 保留历史，excluded_reviewers 约束本次审查；--exclude-reviewer 只补充当前审核的回避身份，不用作永久作者登记。

恢复分别判断文章与地图：article-published.json 加已推进的文章指针表示文章已可用；published.json 加已推进的地图历史或更新地图表示地图也已收尾。状态不能仅根据收据文件存在判断。单独更新地图或完成后续研究不会把此前已发布 Commit 改报为待收尾；发布收据已写、共同指针尚未更新的中断仍报告待恢复。

地图发布收据保留前一发布的引用与哈希。重试已在当前发布历史内的旧请求只读取完成结果，不回写旧版本；即使地图字节相同，也按所绑定的基线发布辨别陈旧请求，保留后来补充的作者身份。


作者身份随完整事实文章跨研究轮继承：新增量、文章整合和发布保留已有贡献者，追加本轮真实作者。历史贡献者不因换一轮或换执行者而丢失，也不据此永久排除他们审核后续无关增量。旧包沿用原身份约束，新包按实际审核范围建立回避名单。

首次地图候选明确绑定“尚无发布记录”的起点；后续出现发布，即使地图字节相同，旧候选也不能覆盖新状态。旧格式候选缺少发布基线且当前已有发布记录时，Main 重新准备基于当前文章的地图请求，原审核档案不改写；这只恢复提图步骤，不重做数学 Commit。

### 地图审核来源记录的发布校验

`source_locator` 含非空 `heading` 与从 1 开始的整数 `line_start`、`line_end`；必须满足 `1 <= line_start <= line_end <= 当前冻结文章行数`。所有 assessments 与 source_coverage 的定位均检查，布尔值不作为整数接受。

`source_coverage` 是非空数组，每项含 `source_locator`、`mapped_object_ids`、`disposition`、非空 `reason`。`covered` 项引用至少一个当前地图 Entry 或 Inference ID；`not-extracted-justified` 项引用空数组并说明不提取理由。单条记录内的引用不得重复或悬空；同一对象可对应多个来源范围，因此允许跨记录引用同一对象。全部范围合并后须覆盖全文所有非空白行，允许重叠，纯空白间隔不视为遗漏；标题、导航和参考文献可包含在相邻范围内，不要求逐行写记录。

发布程序只核实这些记录的结构、范围和引用，不能证明理由正确、定位内容支持对象或数学提取没有遗漏。既有发布收据不改写；尚无发布收据的新发布必须提供完整记录；已有发布收据的幂等重试和中断恢复按原有精确绑定校验，不追补或改写历史报告。
