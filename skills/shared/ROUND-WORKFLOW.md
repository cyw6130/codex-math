# 按轮研究与自动提交合同

## 权限与单一事实来源

本套装推荐 `commitPolicy.mode = per_round_auto`。setup 在项目 `.codex/math-sessions.json` 保存本项目用户真实选择及授权来源；已有授权直接复用，没有授权时先询问。不得把套装作者的历史会话当成接收者的授权。用户选择 manual 时改为人工选定候选，不逐轮重复询问已授权的自动模式。

初次运行把有效策略、目标契约指纹和来源原文保存进目标状态；每轮调度器提供对应授权记录。自动范围是当前目标、本轮已完整回收、可形成自足文章增量的结果；目标变更和原则性新假设仍须 grilling。自动提交不等于自动数学通过。

事实总稿和 Commit 收据是已接纳数学内容的依据。`ACCEPTED_RESULTS.md` 与 proof-state 是可重建索引，记录文章 SHA-256、REQUEST、commit.json 哈希和来源位置。常规下一轮须等完整事实文章发布和事实索引同步；旧地图滞后不阻塞下一轮，也不自动创建建图任务。下一轮以最新有效文章为事实依据，旧地图只供带版本的导航；文章 pending 时先恢复，数学问题按下文 Main 修订通道处理，允许明确关联原请求的 Codex session 修复轮。proof 完成声明需核对根目标、有效依赖、无冲突与无条件外推，并绑定该事实版本；explore 只报告理解变化和收尾状态，不宣称理论完成。

## 轮次定义（新运行使用 v2）

一轮推理是在同一已确认研究范围与同一冻结事实基线上执行的一组有界任务，包括初始任务和允许的补充任务；不是一条回复、一次检查、一个定理，也不是一篇文章的写作周期。

- 开始：先 start 冻结基线；首次任务记入 sending 时消耗一轮预算，发送结果不确定也不得重复计数或当作从未开始。
- 范围：本轮计划、派发清单与上下文绑定同一 Attempt；每个对话至多一个初始任务和一次补充。新接纳前提、原则性范围变化或已关闭后的派发必须另开轮次。
- 推理结束：全部初始/补充任务完整返回，调度器决定不再补充，调用 dispatch_log close。该调用核对完整派发台账并保存不可变 closed.json；关闭后不能添加任务或改变返回状态。
- 默认 Commit 时机：推理结束后立即整理唯一轮次总结和合并数学增量，归档后启动增量审计与 Commit；不得等完整事实文章或地图做好再提交。
- 无增量：记录 no_change，不做空 Commit；探索中的认识变化仍如实保留。
- 失败/中断：超时、未知派发、尚未回收、用户停止时记 failed/interrupted，不能用已返回子集伪装完整轮次提交。先核对原任务，后续推理另开轮次，不重发不确定任务。
- 收尾：Commit、事实文章维护和事实索引同步都是本轮后处理，不再消耗推理轮预算。事实文章未发布或相关数学缺口未解决时不派发无关新轮；文章已发布且事实索引同步后可继续，地图不属于研究轮次必需产物。确需证明 session 修复前述数学缺口时，走明确关联原请求的修复轮，并冻结不受影响的有效前提。推理结束时间与发布完成时间分别记录。

## Main、Codex session 与 Sol 的分工

Main 负责证明规划、自然问题选择、路由、验收决定和首轮修订；三个独立 Codex session 承担主要推理。短证明补齐、条件修正、局部推导可以先由 Main 完成，修改后的数学仍交 Sol 独立审核。只有 Main 判断需要持续新证明探索时才派回证明 session，不按字数或一次拒绝机械升级。

Sol 原生子 Agent 默认 gpt-5.6-sol / medium，审核独立性针对本次审查内容，具体范围见文章接口。修订优先复用原审核者，只看改动和受影响依赖；更换审核者时传准确候选及可复用报告。审核分歧由 Main 分诊：误读先解释，实质分歧由 Main 判断是否请另一位 Sol，确需新推理再交证明 session；未决内容不接纳。

Main 派发 Sol 审核后，优先接收原生完成通知；没有可做的独立工作时使用平台提供的有界子 Agent 等待（单次不超过 60 秒），完成后立即读取报告、导入回执、处理修订并继续接纳或维护。等待超时仅表示尚未返回，不能视为拒绝。每次唤醒先核对审核是否已经完成，避免重复派审。15 分钟 heartbeat 负责长时间 证明 session 任务回收及 Main 中断恢复，不作为短审核的默认接续机制；已有 heartbeat 需按此更新提示，保留其 ID 和通知偏好。Main 不能保证宿主在任务已结束后即时唤醒；发生中断时用现有恢复机制接续并如实说明。

轮次计数：首次数学 sending 计一轮，初始派发与每 Chat 最多一次合法补充合算一轮；等待和 heartbeat 不计轮，无进展也计一轮。Main 修订、Sol 复核、Commit、文章维护均是后处理；预算用尽仍应完成这些本地收尾。另行授权的地图维护不计推理轮，但不是研究收尾条件。推理关闭后重新向 Codex session 派发实质研究任务才新计一轮，必须有剩余或用户追加预算。不要把修订版本号、审核次数和研究轮次混算。

流程给出默认分工和必要交接，Main 根据内容调整任务拆分、修订批次和复核范围；轮次预算与真实数学接纳的含义保持明确。只记录实际意见、修改和依据；后台工具处理 ID、哈希与保存，不把这些变成向用户索取的表格或逐项批准。

## Main 与用户的研究讨论

首次进入一项 run-math 研究时（包括 setup 后第一次运行），必须实际调用 grilling，与用户形成目标/研究意向、关键约定及首轮主要路线的共同理解，再冻结轮初上下文并派发。Main 解释候选方向、困难和首轮要解决的问题；用户只有一句“尝试证明某猜想”、旧文有根目标、配置和预算已确认，都不能替代路线讨论。单向宣布方案或读取 skill 后自行写记录也不算完成；须有真实问答与用户确认。已有相同目标和首轮路线的真实共识可简短回顾复用。尚无可用证明路线时，可商定首轮先调查路线或可行性。

这里的首轮、后续轮都是预算中的推理轮，grilling 的问答轮不计预算。首轮方向商定后，同一目标、关键约定和授权预算内，Main 可在后续轮灵活调整证明方法、探索分支与分工，简短同步依据即可，不逐轮等待确认。改变目标、研究边界、影响结论的额外假设或主要产物方向时，才重新 grilling 取得明确决定。“继续”与在途/收尾恢复沿用仍有效的共识；不为补做启动讨论重复派发或停止既有任务回收。

把 grilling 同时用于重要发现或反例、持续瓶颈和阶段回看：当前命题是否表达真实兴趣，新结果改变了什么理解，是否出现更自然的问题。Main 可提出有材料依据的挑战和建议，由用户决定原则性目标调整；这些过程讨论不设每轮必问次数。所有研究入口在已授权批次结束时另有必需的 [understand-research 理解环节](../understand-research/SKILL.md)，不替代首次研究的启动讨论。

发起讨论时实际读取并遵循环境中的 grilling/SKILL.md。Main 先掌握授权范围内相关材料及可用的事实文章和地图；尚无基线时从用户请求和允许的来源调查，不默认导入本地研究；按 grilling 的事实调查规则补齐可查事实，不把调查工作交给用户。围绕本次讨论构建设计树，将当前前提已明确的问题在同轮一起提出，每题按 skill 格式给建议；直接在对话正文中提问，等待回答后重算下一层。只展开与本次讨论有关的分支，不重复盘问已确认事项。共同理解形成并得到用户确认后执行由该讨论产生的改变；数学真伪仍由推理和独立审核判断，用户的认同不构成数学接纳。

等待只影响依赖该回答的工作。已经授权且不依赖该选择的任务回收、增量审核、文章维护和地图发布继续；保留必要的 heartbeat 回收在途任务，不因讨论整体停机。若待定选择涉及某项内容是否还属于接纳范围，则该内容也等待。用户未回答不视为同意，Main 不预先改目标或发出依赖新选择的任务。已有范围和预算内的独立研究仍可按原规则进行，不绕过轮次关闭、pending 或预算约束。

日常讨论不必转换成 RouteDecision 的 ask_user；它可以伴随当前工作。只有本次路由确需用户决定、尚不能确定派发时才记录 ask_user，该 decision 不同时带 tasks。其他已授权的独立工作照常处理；若形成另一项独立派发，按原规则单独记录其 dispatch。讨论、用户决定及材料依据复用当前对话和现有轮次总结/结果记录，保存真实来源引用；已冻结记录不重写。讨论本身不创建研究轮、Attempt、Commit 或额外审批表。

## 轮次与归档

每轮首次派发前调用 article_flow `start` 冻结当前文章、地图、已确认目标原文和必要来源；一个研究轮次对应一个推理 Attempt；Main 的局部修订另存关联原请求的修订 Attempt，不创建新 round.json，也不增加推理轮计数。登记 round.json，字段见下面。沿用 Codex session 轮次预算、每对话每轮最多一次补充派发、轮次屏障和超时规则。

证明 session 返回即保存完整派发提示与完整回复及对话身份，保持原文。通常只补状态和证据定位，集中在轮次总结解释；确有必要时可保留帮助理解的局部说明。同轮补充任务只能用轮次起点的已接纳前提；提前返回的候选可供明确带条件的探索，但本套装默认将依赖该候选的新派发延到下轮接纳之后。尚未返回或未接纳的结果不能进入无条件共享前提。

全部在途任务返回后，统一写 `round-summary.md`，简短覆盖：研究意向下的当前理解（proof 为根命题状态）；本轮新增/修正的数学内容与范围；失败或排除的路线；剩余缺口与下一轮方向。每个返回任务在总结的结果清单中有 candidate/no_change/rejected 等处置和原文链接，保证没有遗漏，不再每个任务生成独立总结。

只有可审核数学增量时调用 prepare-math-increment，从冻结文章形成局部数学增量及严格 before/after delta，不提前维护完整事实文章。把增量差异与材料处置放入同一轮总结，允许附结构化清单；不重复生成多份进展稿。只有非数学编辑问题记入 EDITORIAL_DEBT.md。

调用 `finish` 归档真实过程和 candidate/no_change/failed/interrupted；每份已返回原文及 round-summary.md 都必须逐个作为 --evidence 传入，不能只作为 transcript 或外部链接。无数学增量时不 prepare、不 Commit、不提取地图；总结仍保存。超时轮保留已回收内容，归档 interrupted，停止派发；恢复时先查原在途任务，不重复发送。

## 按轮自动提交

本轮唯一 ROUND_DIR 是项目 `research/results/<target>/round-<N>/`；round.json、policy.json、原始返回和 dispatch/ 均在其下。`.codex/run-math/` 只存调度状态和目标策略，不另存第二份活动派发台账。round.json 位于本轮目录；至少含 schema=`codex-math-round/v2`（v1 仅用于旧归档恢复）、target_id、contract_sha256、round（正整数）、attempt_id、request_id、author_identity、contributor_identities、tasks（每项 id/status；returned 项还须 source、complete=true、author_identity）、summary、outcome。source/summary 为相对 round.json 所在目录的路径；任务状态均为 returned 才可 prepare。outcome 为 candidate/no_change/failed/interrupted；contributor_identities 包括全部 证明 session 作者和候选写作者的真实身份。保存 baseline article SHA-256 供恢复对照。新增 research_mode=proof/explore；旧记录缺省按 proof 读取。explore 另有 exploration 字段，指向相对本轮目录的 exploration.json，内含 targetId、activeContractFingerprint、questions/observations、researchOutcome、来源和实际理解变化；该文件也须传 finish --evidence。policy.json 的 research_mode 必须相符。

授权 JSON 含 mode、target_id、contract_sha256、authorization（用户原文和来源引用）。新 v2 对 candidate/no_change 还必须有 closure，指向相对本轮目录的 dispatch/closed.json。该文件必须作为 finish Evidence 冻结；其中 Attempt、共同上下文、任务全集及每项完整返回来源哈希必须与本轮一致；共同 context.md 在 start 时作为 --source 冻结，派发开始不得早于 Attempt 创建。先调用 `python3 DISPATCH_LOG ROUND_DIR/dispatch close --now ISO_TIME`。

调用：

`python3 ROUND_FLOW ROOT --round ROUND_JSON --policy POLICY_JSON`

ROUND_FLOW 为本套装 runtime/round_flow.py（初始化复制进 ROOT/.workflow/）。它核对授权、轮次屏障、完整原文、总结、Attempt、请求绑定与重试一致性，然后 prepare。一轮只有一个初始自动 REQUEST；后处理可有与它相连的修订 REQUEST，原轮次 binding 不变，恢复时沿关联链定位最新候选或 Commit；无增量仅留下轮次收尾记录。它不调用模型或自动判定数学。

prepare 之后调用 review-math-article，scope=`fact-increment`，先做一次增量数学审核；有修订时优先交原 Sol 定向复核，复用仍有效的检查。独立原生 reviewer 回避本次候选及需重审内容的作者，历史贡献者不一概排除。按 ARTICLE-WORKFLOW 导入真实回执并 accept；通过的数学增量进入 maintain-math-article，随后才维护完整事实文章；按 ARTICLE-WORKFLOW 的整合分级核对忠实性与完整性，不重复数学接纳。通过后立即 publish-article，同步事实索引，再继续有预算的下一轮。整批研究结束后进入 understand-research；不自动提图或审图。

审核意见先交 Main 判断：误读先澄清，表达问题可集中处理，不为每条意见单开修订。需要改变数学时由 Main 修正条件、重写增量或补齐短证明；形成可再次送审的候选时再冻结关联修订，优先由原 Sol 定向复核。原文、旧候选和旧报告不覆盖。尚未解决的项保留候选状态，不把一次拒绝直接计为下一轮。纯文章整合或图提取问题恢复同一 Commit；若发现数学问题，文章未发布时按 start --repair-of 暂停原请求并保存更正增量；文章已发布时以当前文章另存更正增量。两者均经 Sol 审核和 Commit 后更新文章；旧地图按版本和失效信息标明适用边界，重提取由用户另行选择。地图的提取遗漏或展示问题不暂停无关研究；原文数学缺口按失效规则暂停受影响前提。

文章发布成功后由调度器同步结论索引、proof-state、RouteDecision outcome 和 round-status.json 的文章链接；地图完成后再补地图链接及其来源文章版本；这些更新可重放。中断恢复先核对真实收据和版本再补索引，不重复 Commit。round-summary.md 的已归档原文保持不变，审核/发布结果写入 round-status.json 并在用户轮次报告中合并展示。

## 完整写作与失效

一个已授权研究批次结束时，调用 maintain-math-article 按 ARTICLE-CONTENT 检查累积账本的编排、主要陈述位置、总览与开放边界，落实必要整理；已发布文章走纯编辑修订入口。该整理是后处理，不新开 Codex session 轮，不要求派生论文，也不重写冻结轮次总结。若无变化，记录已检查范围即可；若有编辑版，同步当前事实索引，历史轮次链接仍绑定各自原版本。随后调用 understand-research 共同梳理主要结果与证明；理解中需写回文章的内容按文章接口维护或更正。用户确认理解后选择建图或暂不继续；若选择形式化，先整理并轻量审核相关数学地图，再在地图上准备 Lean 蓝图；编辑修订不自动生成地图待办。

平时保留充分数学正文，proof 只在根目标完成或用户明确要求时调用 write-complete-math-article；explore 只在用户要求时完整成文。派生论文在 paper/，不替换事实总稿，不为每轮 Commit 做全文润色。

发现来源数学缺口时，先保存 invalidations.json（结论、依赖、事实版本、证据），阻断受影响前提和 completed；旧事实文章标记存在未决更正，不能继续当作无条件有效基线。Main 优先更正或撤回；未发布请求走关联修订 Attempt/Commit，已发布内容基于当前版本另存更正增量与原收据引用，旧地图标明受影响内容，不再作为有效证明依据；重新提取地图由用户另行选择。Main 局部修订不消耗推理轮。需证明 session 持续研究时才由 Main 在预算内明确派发修复轮；受影响前提不得作为无条件依据。失效的派生论文撤出当前展示入口并保留原件与历史记录；不能静默改写已冻结事实文件。

## 探索记录与数学状态

无数学增量的 explore 轮可以同时 outcome=no_change、researchOutcome=understanding_advanced：前者指事实总稿无增量，后者指已有具体来源支持认识变化。exploration.json 和总结是研究记录，不是另一份已接纳数学真源。摘要不替代原始 Evidence。

事实总稿可以收入明确标注的猜想、开放问题和条件性命题，fact-increment 审核的是表述、条件与证明状态是否准确。它们不能以“已通过审核”为理由变成已证明前提。地图仅提取准确总稿，按同样认识论状态展示；无增量轮不更新地图，历程仍可见。
