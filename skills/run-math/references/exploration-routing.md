# 探索路由

## 状态与来源

探索优化的是有依据的理解变化，不要求预先锁定一个猜想。保持不可变的初始研究意向；用户确认的新意向追加在 contractRevisions，原文不覆盖。每轮具体问题由材料调查产生，允许关联已有例子、现象或文献，也允许比较并排除问题。

当前状态保存在 .codex/run-math/<target>/exploration-state.json，schema=run-math/exploration-state-v1。decision 使用 run-math/exploration-decision-v1。机器规则由 tools/validate-exploration.mjs 执行，公开入口为 `node tools/validate-research.mjs STATE [DECISION]`。状态不能混入 proof 根命题或 completed。

状态必填：

- targetId；intention：id、verbatimUserRequest、sourceRequestRef、objects、interest、scope、conventions、fingerprint。
- contractRevisions 数组；每项 previousFingerprint、intention（完整新意向）、grillingEvidence、approvedAt；activeContractFingerprint 指向最后真实批准的版本。
- roundBudget 正整数；roundsStarted 已开始轮次数；status 为 running/blocked/budget_exhausted/stopped。
- questions、observations、acceptedResults；researchOutcome 为 understanding_advanced/no_verified_progress/invalidated；fingerprint。

intention 和整个 state 的 fingerprint 分别由导出的 fingerprint(value) 计算：去掉本对象 fingerprint，递归排序键，按 UTF-8 JSON 算 SHA-256。更改状态后重算 state 指纹；初始意向不随每轮问题变更而重写。

每个 question：id、statement、motivation、relationToIntention、sourceRefs（非空实际来源）、contractFingerprint、status=open/selected/resolved/retired/deferred。自然性和价值必须解释，不能只列题名。范围变化留下旧问题历史，旧范围问题不可直接派发。

每个 observation：id、kind、statement、evidenceRefs、questionIds、status=recorded/candidate/accepted/invalidated。kind 可为 sharpen_question、distinguish_examples、identify_relationship、identify_obstruction、establish_result、exclude_direction。单纯定义增多、重复已有说法或空泛“有启发”不能算 understanding_advanced。其判断需在本轮 exploration.json 明确写实际依据与理解变化。

acceptedResults 是派生索引：id、status=accepted/conditional/invalidated/superseded、articleSha256、receiptRef。accepted observation 另带 resultId，引用已接纳结果。recorded 表示研究观察已记载，不表示其中数学命题为真。未审核猜测不得进入 acceptedResults 作为无条件前提。

## 决定与派发

每个 decision：schema、id、targetId、intentionRef、activeContractFingerprint、basedOnStateFingerprint、action。

- dispatch：round 为本轮或下一轮且在预算内；tasks 非空。每项 taskId、dialogueRef、questionId、objective、expectedUnderstandingEffect（同 observation kind）、premiseRefs、premiseMode=accepted_only/conditional_exploration、successEffect、failureEffect、mayCountAsTheoryCompletion=false。
- ask_user：grilling 含 skill=grilling、reason、questions，用于本次路由确需用户决定而暂不能派发的情形。普通选题沿用范围授权；对理解、意外结果或兴趣的主动讨论按 [研究讨论](../../shared/ROUND-WORKFLOW.md#main-与用户的研究讨论) 进行，不必设为 ask_user，也不暂停已授权的独立工作。该 decision 不同时带 tasks；讨论后改变原则性边界仍需用户明确决定。
- stop：stopReason=budget_exhausted/blocked/no_grounded_question/user_stop。no_grounded_question 要在轮次总结中说明已考察哪些来源/候选和为何不足；不能机械以一个无增量轮作为停止条件。

先调查自然问题，再决定一次有界任务，回收后检验实际理解变化。具体命题的证明可作为一个 explore 任务；若用户选择将其变成长期固定目标，保留原探索记录并创建明确的 proof 目标，不静默切换模式或改写历史。

机器检查数据引用、版本、状态与权限结构，不裁定问题是否有数学价值，也不替代事实独立审核。来源是否支持判断由调度者与数学审核按职责核对。

## 轮后冻结记录

每轮 exploration.json 是该轮记录，不是整个探索状态的替代品。必须含 targetId、activeContractFingerprint、researchOutcome、questions、observations。questions 每项含 id、statement、motivation、sourceRefs；observations 每项含 id、kind、statement、questionIds、status 和 evidenceRefs。状态只取 recorded/candidate/invalidated；新数学接纳在后续 Commit，不在轮后记录中自授 accepted。understanding_advanced 至少需要一项 recorded 且有来源的具体观察。

该轮 sourceRefs/evidenceRefs 使用相对 round.json 目录的真实文件路径，或 `attempt:base-paper.md` 等冻结档案键。相对路径必须已作为 finish Evidence 冻结；attempt: 引用必须对应已冻结基线或 Evidence。纯字符串标签或不可访问的外部路径不能满足归档检查。用调度状态中的稳定来源 ID 时，在轮后记录转换成该轮准确冻结来源定位。记录猜想为 candidate 本身不构成已核实理解进展；“为何产生此问题”的真实观察可单独 recorded 并提供依据。
