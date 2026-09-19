# Run Math 项目配置

项目配置使用 `.codex/math-sessions.json`。setup-math 创建、核验并绑定三个独立 Codex 任务；run-math 只读配置并派发。恢复记录在 `.codex/math-sessions.setup.json`，不能当作正式配置。

## run-math/v1 schema

```json
{
  "schema": "run-math/v1",
  "proofDialogues": [
    {"threadId": "real-codex-id-1", "hostId": "local", "title": "项目-证明-1", "projectId": "saved-project-id", "cwd": "/real/project"},
    {"threadId": "real-codex-id-2", "hostId": "local", "title": "项目-证明-2", "projectId": "saved-project-id", "cwd": "/real/project"},
    {"threadId": "real-codex-id-3", "hostId": "local", "title": "项目-证明-3", "projectId": "saved-project-id", "cwd": "/real/project"}
  ],
  "creationSettings": {"model": "USER_SELECTED_SUPPORTED_MODEL", "thinking": "USER_SELECTED_SUPPORTED_EFFORT"},
  "collaborationPolicy": {"mode": "standard", "customInstructions": null},
  "defaultRoundBudget": 3,
  "fastCheckIntervalMinutes": 15,
  "maxCheckIntervalMinutes": 30,
  "taskCollectionDeadlineMinutes": 120,
  "commitPolicy": {"mode": "per_round_auto", "authorization": {"verbatim": "本项目用户真实授权", "source": "真实来源引用"}, "factsRoot": "facts/"}
}
```

示例是字段说明，示例 ID、路径、模型与授权不得直接写作真实配置。proofDialogues 为证明任务集合；必须恰好三个不同的、经真实创建回执、list_threads 项目元数据与 read_thread 可达性组合核验的 Codex 任务，hostId 一并用于 read/send/wait。同一 saved project、同一 cwd；标题和 projectId/cwd 是核对快照，身份依据 threadId + hostId。read_thread 不保证返回类型或项目字段，缺失时不能猜测；核验依据不足就保留待核对并停止派发。排除 Main；不得接受普通 ChatGPT、云 Work、原生子 Agent ID 或 clientThreadId。

creationSettings 仅是创建时用户所选模型及强度。setup 直接询问并明确后续可改；创建后不查询猜测、不强制对齐。发送研究任务不传 model/thinking。collaborationPolicy 为 standard/custom；标准分工见轮次合同，自定义不能移除数学接纳、预算或独立性要求。defaultRoundBudget 为正整数，单次明确预算可临时覆盖。

fastCheckIntervalMinutes=15、maxCheckIntervalMinutes=30 只用于持久 heartbeat 的恢复检查；Main 活跃时使用 wait_threads 有界等待并及时接续。taskCollectionDeadlineMinutes=120 从每项 sending 起算。commitPolicy 使用目标项目用户真实选择，mode 为 per_round_auto/manual，factsRoot 默认 facts/；自动模式必须有该项目真实授权，启动目标时按原 round_flow 接口绑定 target_id 和 contract_sha256。

只接受经过上述核验的任务绑定；同一事实工作区只能由一个 Main 调度。有事实 pending/在途研究时先恢复或明确完成交接。研究状态目录为 `.codex/run-math/`，轮次证据归档在 `research/results/`；数学 schema 见下文与轮次合同。

## 研究轮次状态

- 研究轮次从首次数学派发开始；同轮包括首次派发波次和所有补充派发。
- 轮次屏障只在同轮所有在途任务都返回并完成统一整理后到达。检查或 heartbeat 唤醒不计为轮次。
- 已返回结果可以触发独立补充，但补充不得依赖待回结果或改变本轮共享前提；每个证明对话每轮至多一次补充派发。补充仍须返回并纳入本轮整理。
- 最后一个预算内轮次越过屏障并完成统一整理后，继续完成 Main 修订、Sol 复核、Commit、文章维护与事实索引同步等本轮收尾；地图不作为完成条件；完成后删除 heartbeat，不得开启新数学派发轮次或继续空唤醒。
- 每个任务从派发起最多等待 120 分钟；超时则保存已有结果、将当前轮次记为 `blocked`、停止本地自动调度和 heartbeat，并通知具体未返回对话。不得伪装完成或越过轮次屏障。

## 运行状态与证明状态分离

每个目标使用三个相互独立的持久对象：

```text
.codex/run-math/<target>/
├── state.json
├── proof-state.json 或 exploration-state.json
└── route-decisions/<timestamp>-<decision-id>/
    ├── decision.json
    └── outcome.json
```

- `state.json` 保存模式、轮次、预算、在途任务、heartbeat、文章路径；proof 生命周期为 running/blocked/completed/budget_exhausted，explore 为 running/blocked/stopped/budget_exhausted；
- proof 的 `proof-state.json` 保存不可变根目标、知识边界、义务图、路线生命周期、有效结果引用和 `researchOutcome`；
- `decision.json` 是派发前已经校验的不可变路由决策；`outcome.json` 保存结果接纳后的实际 proof-progress effect 与 frontier delta。

仅 proof 的 `completed` 必须同时满足：根义务为 `closed`、`researchOutcome: root_completed`、完成证据与活动契约指纹及有效接纳索引一致。`budget_exhausted` 可以伴随 `proof_advanced`；运行生命周期不能替代研究成果判断。

proof 新运行使用 `run-math/proof-state-v1` 与 `run-math/route-decision-v1`；explore 使用 exploration-routing 定义的两个独立 schema。旧运行保持只读兼容；明确恢复时生成迁移候选，无法确定的义务关系阻止派发，不改写历史原始记录。

## 模式选择与兼容

run-math 每次从明确请求选择 research_mode=proof/explore，目标 state 和 policy 必须一致。旧记录没有模式按 proof 读取，不把旧根命题自动改为研究意向。explore 的运行状态为 running/blocked/budget_exhausted/stopped，研究状态保存在 exploration-state.json，完整写作只由用户触发。状态字段详细约束读 exploration-routing.md。跨模式创建新目标与关联记录，保留原任务历史；研究范围实质变化保存 grilling 决定。

执行分工与轮次按 [轮次合同](../../shared/ROUND-WORKFLOW.md)：Main 规划、路由、验收并优先局部修订；Codex 证明 session 主推理；Sol/medium 独立审核。Main/Sol 后处理不增加推理轮；pending 数学缺口可走关联修订通道。
