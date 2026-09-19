# Proof-progress 路由契约

本文件是 `$run-math` 数学语义路由的唯一事实源。`SKILL.md` 只规定何时调用本 Interface；字段、状态、不变量和迁移规则以本文件为准。运行生命周期、原始证明记录与文章事务分别由 `project-state.md` 和 `research-artifacts.md` 管理。

## 1. 目标与成功语义

一次运行优化的是有界预算内的**可靠、可累计证明进展**，不是最容易完成的子命题，也不是文章长度。

- 原始 `rootTarget` 不可变。普通引理拆分、等价改写、反例搜索和有限计算不修改根目标。
- 修改命题、适用范围、改变真假的约定或成功标准，加入原则性新假设，采用替代目标，或把 `reproduce_known` 作为主要产物时，由 Main 调用 `grilling` 讨论；用户已有明确决定时直接复用并保存来源。只暂停依赖该改变的任务，继续在途回收及已授权的独立收尾；用户明确决定并保存契约修订后再执行新范围。
- 子目标只有声明并通过 `relationToRoot` 与根目标连接时才能消耗预算。特殊情形不能计作一般命题完成。
- `completed` 只表示根目标义务关闭；其他真实进展写入 `researchOutcome`。

`researchOutcome` 取值：

- `root_completed`：根目标已经关闭；
- `proof_advanced`：关闭、拆分或严格缩小了证明前沿；
- `route_refuted`：排除了一条此前活跃的证明路线；
- `no_verified_progress`：没有经过验收的前沿变化；
- `invalidated`：先前用于路由的结论被撤回。

因此 `state.json.status: budget_exhausted` 可以与 `proof-state.json.researchOutcome: proof_advanced` 同时成立。

## 2. proof-state Interface

每个目标维护：

```text
.codex/run-math/<target>/proof-state.json
```

机器结构以 [`schemas/proof-state.schema.json`](schemas/proof-state.schema.json) 为准。核心字段：

```json
{
  "schema": "run-math/proof-state-v1",
  "targetId": "stable-target-id",
  "fingerprint": "current-proof-state-fingerprint",
  "rootTarget": {
    "id": "goal-root",
    "verbatimUserGoal": "用户原始目标原文",
    "sourceRequestRef": "当前任务中的来源引用",
    "statement": "原始用户目标",
    "scope": "适用范围",
    "normalizationBoundary": "改变真假的约定",
    "fingerprint": "immutable-root-fingerprint"
  },
  "activeContractFingerprint": "immutable-root-fingerprint",
  "contractRevisions": [],
  "knowledgeBoundary": {
    "knowledgeStatus": "unchecked",
    "knownResultsBoundary": "",
    "sourceRefs": [],
    "routeImplication": "首次派发前仍需完成分级检查"
  },
  "obligations": [],
  "routes": [],
  "frontierObligationIds": [],
  "acceptedResults": [],
  "researchOutcome": "no_verified_progress"
}
```

### 根目标修订

`rootTarget.verbatimUserGoal` 与 `sourceRequestRef` 先于任何规范化保存，用于审计初始目标是否已经被缩窄。`contractRevisions` 只追加，不覆盖 `rootTarget`。每项保存 `revisionId`、`grillingEvidence`、`approvedAt` 与 `newContractFingerprint`；`activeContractFingerprint` 必须指向最后一个已批准修订。没有修订时，它必须等于原始 `rootTarget.fingerprint`。

### 证明义务

每个 obligation 保存稳定 `id`、数学陈述、机器可检验的 `relationKind`、解释性的 `relationToRoot`、直接依赖、状态、支撑材料和当前最小缺口。`relationKind` 取 `root | lemma | equivalent | necessary_condition | special_case | counterexample | bridge | audit`；特殊情形必须通过迁移桥连接到另一证明义务。状态取值：

- `open`：当前可推进；
- `candidate`：有候选结果，尚未完成独立 Commit 接纳；
- `closed`：已由有效接纳结果关闭；
- `refuted`：义务本身被反驳；
- `blocked`：缺少明确输入；
- `superseded`：被更精确的义务或归约取代。

`frontierObligationIds` 只包含当前 `open` 或 `candidate` 的义务。调度状态由 proof-state 表达，已接纳数学内容以事实文章及其真实收据为依据；索引冲突时核对准确事实版本后重建派生索引。发现数学疑点按轮次合同先阻断受影响依赖，再形成更正增量。

### 路线生命周期

路线状态取值 `active | blocked | refuted | superseded | paused`。重新启用 `blocked`、`refuted` 或 `superseded` 路线时，必须保存新的有效输入；没有新输入不得重复消耗预算。

## 3. 知识边界

首次派发前形成 `knowledgeBoundary`：

- 著名猜想、公开命题或可能已知的特例：查权威来源，区分 `known | open | conditional | disputed`；
- 项目内部新定义命题：先查正式状态、接纳索引和研究记录，可保留 `unchecked`，但必须说明为何不影响首次路由；
- 运行中出现新的文献或“可能已知”证据：更新知识边界并重新生成 RouteDecision。

新颖性决定成果定位和路线价值，不自动阻止已知引理。`reproduce_known` 只有声明 `transferToObligationId` 与可验收 `transferMechanism` 时才可派发。

根目标是著名开放问题时，`open` 本身不是 `no_viable_route`。只要预算内仍存在直接攻击根义务、严格分解开放前沿、寻找候选引理、反例搜索或核准承重文献边界的可验收任务，就继续 `dispatch`；同时向用户明确一般问题仍开放和本次预算的合理产物。只有这些路线也无法形成具体交付物时才停止。已知特殊情形没有迁移桥时只排除该特例路线，不排除整个根目标。

## 4. RouteDecision Interface

每个派发波次前先验证并保存不可变 decision：

```text
.codex/run-math/<target>/route-decisions/<timestamp>-<decision-id>/decision.json
```

回收并接纳结果后，把实际效果保存到同目录 `outcome.json`；不修改原 decision。机器结构以 [`schemas/route-decision.schema.json`](schemas/route-decision.schema.json) 为准。

日常研究讨论按 [研究讨论](../../shared/ROUND-WORKFLOW.md#main-与用户的研究讨论) 主动开展，可以伴随当前工作，不必转换成路由动作。讨论不改变已授权前提，也不自动产生新研究轮。

路由动作只有：

- `dispatch`：存在合法、可验收的 proof-progress 任务；
- `ask_user`：本次路由需要用户决定、尚不能确定派发，由 Main 使用 `grilling` 讨论；该 decision 不带 tasks。继续回收在途任务和已授权的独立收尾，不因提问停止必要 heartbeat；
- `stop`：根目标完成、预算耗尽、阻塞、没有合法路线或用户停止。

每个 decision 的 `basedOnProofStateFingerprint` 必须等于它实际读取的 proof-state 顶层 `fingerprint`。每个派发任务绑定根目标、义务、现有 `routeId`、临时角色、前提、预期效果、成功/失败效果和新颖性状态。`routeRole` 只属于本任务，不永久绑定证明对话。指向 `special_case` 义务的任何任务都必须声明 `transferToObligationId` 和可验收的 `transferMechanism`，即使它没有声称根目标完成。

允许的预期 proof-progress effect：

- `close`
- `reduce`
- `split`
- `refute_route`
- `verify_premise`
- `identify_missing_hypothesis`
- `construct_certificate`
- `audit_dependency`
- `reproduce_known`

结果返回后独立裁决实际效果；预期 `close` 可以实际成为 `reduce`、`refute_route`、`no_progress` 或 `invalid`。只有真实改变 obligation graph 的负面结果才算进展。

## 5. 路由优先级与停止

在多个开放义务之间按以下优先级路由：

1. 关闭关键依赖的当前证明前沿；
2. 能否定整条错误路线或显著减少搜索空间的审计；
3. 把抽象缺口变成有限证书的归约；
4. 产生新具体输入的计算或例子；
5. 有明确迁移机制的旁支。

按证明杠杆排序，不按“最容易写出完整证明”排序。有剩余预算也可以提前停止：当没有合法路线、必须等待新计算/文献/外部输入、所有路线已退役，或继续派发只能重复已有内容时，使用 `stop`。改变目标可能打开路线时改用 `ask_user`。

`no_progress` 仍消耗已经投入的轮次预算，但不能包装成 `proof_advanced`。

## 6. 接纳与前沿更新顺序

每轮按 [轮次合同](../../shared/ROUND-WORKFLOW.md) 的顺序处理：保存全部完整原文；轮次屏障后写一份总结和一份候选增量；自动 prepare；独立 fact-increment 审核、accept；维护完整事实文章、核对整合并 publish-article；同步绑定事实版本的 ACCEPTED_RESULTS、obligation graph 与 outcome；最后生成下一轮 RouteDecision。

原始返回先是 candidate。只有已发布且有效的 accepted 结果可成为下一轮无条件共享前提；conditional 只能用于明确标注的条件探索，不能关闭无条件根目标。无增量与审核拒绝保留旧事实基线；文章 publication_pending 先恢复，地图滞后不阻塞有效文章使用；数学问题按轮次合同交 Main 关联修订。

## 7. 兼容迁移

新运行必须创建 v1 proof state。旧运行保持只读；用户恢复旧运行时，从原始目标、有效接纳索引和研究记录生成迁移候选，通过一致性检查后再启用。不能确定的关系标为 `unresolved` 并阻止派发，不改写历史原始记录。

运行前使用仓库校验器检查 proof state 与 decision：

```bash
node tools/validate-proof-routing.mjs \
  --proof-state .codex/run-math/<target>/proof-state.json \
  --route-decision .codex/run-math/<target>/route-decisions/<decision>/decision.json
```

校验失败时不派发；先修正状态或进入 `ask_user`。

## 文章版本绑定

本套装只有已发布 Commit 支持的有效结论才能作为 accepted 路由前提。按 [轮次合同](../../shared/ROUND-WORKFLOW.md) 保存 REQUEST、收据哈希和文章哈希；proof-state 与 ACCEPTED_RESULTS 是派生调度索引。上一轮文章尚未发布或事实索引尚未同步时先恢复；旧地图滞后不创建研究待办，也不阻塞下一轮，路由读最新文章，旧地图只作标明版本的导航；明确关联的 Codex session 修复轮按轮次合同计数。
