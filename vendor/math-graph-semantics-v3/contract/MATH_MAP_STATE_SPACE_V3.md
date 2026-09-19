# Math Map State Space v3

`cmath-gamma.math-map-semantics/v3`（生态中立合同名 `cmath.math-map-state/v3`）定义严格数学状态 `M` 的合法结构和确定性派生。它不定义草稿、审核、写入授权、持久化、来源治理、路线状态或前端。

## 1. Interface

Module 只提供一个主要 interface：

```js
deriveMathState(M)
```

输入非法时抛出带稳定 `code` 的错误；输入合法时返回 Closure、Claim 状态、派生见证和开放阻塞诊断。函数不修改输入，也不写入外部状态。

## 2. 严格数学状态

```text
M = Entries + Inferences + NegationPairs + B0
Closure = derive(M)
```

逻辑容器恰有四个顶层字段：

```js
{
  entries: [],
  inferences: [],
  negationPairs: [],
  b0ClaimEntryIds: []
}
```

所有字段均为数组；未知顶层字段非法。位于 `M` 中就意味着对象已经 formal，不另设 `formal` 或 `draft` 字段。

## 3. Entry

```text
Entry = Fact | Claim
Fact = definition | algorithm | calculation
Claim = lemma | proposition | theorem
```

Fact 的字段恰为：

```text
id / entryClass=fact / factKind / title / statement
```

Claim 的字段恰为：

```text
id / entryClass=claim / claimKind / title / statement
```

所有字符串必须非空且不得带首尾空白。kind 是封闭集合；新增 kind 产生新的能力主版本。

### Claim Narrative Role

`lemma | proposition | theorem` 是 Claim 在当前数学研究项目中的项目级叙事角色，不表示逻辑强弱、证明难度、可信等级或证明状态：

- Lemma 是局部、战术性、中间性或工具性的结果。
- Proposition 是非核心但可以独立陈述、构成实质性研究进展的结果。
- Theorem 是项目的核心数学内容、核心答案或最终结论。

Narrative Role 在 Entry 进入严格数学状态 M 时确定，此后不变。路线选择、Claim 状态以及后来对内容正确性的判断都不回写这一角色；即使一个 Entry 后来被判错，其 Narrative Role 也保持原值。外部来源中的命名不决定项目内角色。

Corollary 不是第四种 Claim kind，而是结果与其推导来源之间的关系描述；该结果仍根据它在当前项目中的叙事作用归入 lemma、proposition 或 theorem。

所有 Fact 天然可用，不具有 Claim 数学状态。

## 4. Inference

Inference 的字段恰为：

```text
id / operationKind / premises / conclusion / argument
```

`operationKind` 仅为 `proof | organization`。Inference 没有语义 `title`。

- premises 至少一个，是无重复的联合依赖集合；顺序没有数学语义。
- conclusion 恰好一个。
- argument 必须是非空、来源忠实的论证。
- 所有端点必须引用同一 `M` 中的 Entry。

Proof：

```text
(Fact | Claim)+ → Claim
```

不同 proof 指向同一 Claim 时构成替代路径；任一路径的全部 premises 可用即可建立结论。proof 循环合法，但没有 B0 或循环外入口时不能自行建立 Claim。

Organization：

```text
(Fact | Claim)+ → Fact(definition)
```

Organization 表达概念形成，不参与 Closure，不改变 Claim 状态。organization 自环或多节点循环非法。

## 5. ID

Entry 与 Inference 在单个 `M` 中共享全局命名空间。ID 区分大小写；首尾空白导致验证失败，不进行静默规范化。跨提交稳定性、改名和 revision 不属于本合同。

## 6. B0

B0 是可靠的外部 Claim 前提子集：

- Fact 不得进入 B0。
- B0 不得重复。
- 来源范围内部提出但未证明的 Claim 保持 open。
- 若移除某个 B0 种子后，该 Claim 仍能由其他 B0、Fact 与 proof 独立建立，则它已经在范围内重新证明，不得再属于 B0。
- B0 可以为 proof 循环提供入口；仅有指向 B0 Claim 的循环 proof 不构成独立重证。

## 7. Negation Pair

Negative Claim 是普通 Claim，不是新的 Claim kind。

```js
{ claimEntryIds: ["P", "not-P"] }
```

NegationPair 没有独立 ID，其无序 Claim 端点集合就是关系身份：

- 两端必须是不同 Claim。
- 重复或反向重复非法。
- 一个 Claim 最多属于一个 NegationPair。
- 未知字段非法。

## 8. Closure 与 Claim 三态

Closure 初始可用集合为全部 Fact 与全部 B0 Claim。反复应用 proof，直到不再有新的 Claim 可以加入。

```text
P ∈ Closure                  → established
P ∉ Closure, ¬P ∈ Closure    → refuted
P ∉ Closure, ¬P ∉ Closure    → open
P ∈ Closure, ¬P ∈ Closure    → M 非法
```

严格状态只有 `open | established | refuted`；不存在 `supported` 或 `inconsistent`。

## 9. 派生结果

`deriveMathState(M)` 返回：

```js
{
  availableFactIds,
  b0ClaimEntryIds,
  closureClaimEntryIds,
  claimStates,
  claimDerivations
}
```

派生见证：

- B0 established Claim：`{ basis: "b0" }`。
- proof established Claim：`{ basis: "proof", establishingProofIds: [...] }`，包含所有当前可用的直接 proof。
- refuted Claim：记录 `negatingClaimEntryId` 与 `negationPairClaimEntryIds`。
- 无 proof 的 open Claim：`{ basis: "open", reason: "no_proof" }`。
- 有 proof 但尚未闭合的 open Claim：逐条记录 `proofId` 与 `missingPremiseIds`。

见证只解释当前 `M` 的确定性结构，不是来源证据、审核记录或路线选择。

## 10. 稳定错误码

- `INVALID_STATE_SHAPE`
- `UNKNOWN_FIELD`
- `INVALID_ENTRY`
- `DUPLICATE_ID`
- `INVALID_INFERENCE`
- `UNKNOWN_REFERENCE`
- `INVALID_NEGATION_PAIR`
- `ORGANIZATION_CYCLE`
- `INVALID_B0`
- `CONTRADICTORY_CLOSURE`

## 11. 明确排除

本能力不拥有数学草稿、Candidate、Review、TransitionProposal、Governance Receipt、来源位置、证据等级、持久化或序列化格式、revocation、Route、Task、Attempt、Obstacle、命名、布局和前端。
