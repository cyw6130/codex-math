# 派发与中断恢复

每轮使用独立目录 `research/results/<target>/round-<N>/dispatch/`；不同轮次不能复用台账。round.json、policy.json、原始回复和该 dispatch/ 置于同一 ROUND_DIR；closure 固定写 dispatch/closed.json。runtime/dispatch_log.py 只写本地发送日志，不调用外部对话。只对已通过模式路由校验、且任务绑定本轮固定上下文的任务使用。

## 顺序

1. 先生成共同 context.md 并作为 start --source 冻结到本轮 Attempt；所有任务使用这一共同上下文哈希，任务专属内容放各自 prompt。生成完整 prompt.md，包含稳定 task ID、共同 context.md 的 SHA-256 和实际数学正文。调用 `python3 DISPATCH DIR prepare ID --dialogue THREAD_ID --prompt PROMPT --context SHA256 --attempt ATTEMPT_ID --now ISO_TIME`，保存原文及 prepared。
2. 调用 `python3 DISPATCH DIR transition ID sending --now ISO_TIME`，然后才发送。sending 写绝对 deadline=发送开始+120分钟。
3. 发送明确成功后把实际工具回执保存为文件，调用 `transition ID sent --now ISO_TIME --evidence RECEIPT`；逐项处理并行波次。
4. 外部调用结果不确定时用 `transition ID unknown --now ISO_TIME`；如果进程已中断则磁盘 sending 同样视为不确定。重新读取该具体对话，核对 task ID、prompt 内容与上下文版本。确认收到用 found，明确未发出用 absent，均须 --evidence 保存真实核对记录。不能仅凭当前没有回复判 absent。
5. 只有 prepared/not_sent 可再次进入 sending。already sent/unknown 不重复发送。回收完整提示/回复并保存后用 returned 记录，附件缺失仍由原文完整性规则阻断提交。

sent/found 保留最初 deadline。发现本地已落盘事件时直接复用，不再次执行同一状态迁移。历史 Evidence 不覆盖。内部 task ID 在 证明 session 正文中可见，但不进入数学文章。

## 检查与补充派发

`python3 DISPATCH DIR next-check --now ISO_TIME --suggested ISO_TIME` 返回不晚于最早在途 deadline 的检查时刻。sending/dispatch_unknown 应立即进行对话核对，不等待常规轮询。到期先最终检查，仍无返回再按 run-math 规则 blocked；之后停止该 heartbeat，避免对过期任务无限空轮询。

补充派发的 decision 附带 supplement.json：expectedBenefit、estimatedAddedWaitMinutes、deferReason（为什么值得现在做而非下轮）、contextSha256。调度者检查每对话每轮最多一次，固定轮初前提，不依赖新候选。这里记录判断依据，不硬设未获用户确认的额外时间预算。

此日志防止在状态不确定时盲目重发，不能令外部聊天 API 具备 exactly-once 语义；任务是否送达必须用真实对话证据核对。

## 关闭推理阶段

全部初始和补充任务完整返回、不再追加本轮任务时调用 `python3 DISPATCH DIR close --now ISO_TIME`。它核对同一 Attempt、共同冻结上下文、完整任务清单和原始返回哈希，生成 closed.json；之后 prepare/transition 拒绝变动。round.json 使用 v2、closure 指向该文件；将它与全部返回原文、唯一轮次总结一起传入 finish --evidence，再由 round_flow 准备增量审计。未知、未返回、超时任务阻断关闭与自动 Commit，按 interrupted 归档。

## Codex session 传输与权限

send_message_to_thread/read_thread/wait_threads 均使用配置中的 threadId + hostId，不能使用 clientThreadId；发送不传 model/thinking，不覆盖用户后续模型设置。Main 活跃时用 wait_threads（单次至多 60000ms）等待所有在途目标并保存 cursor；heartbeat 只负责兜底恢复。完成信号不是完整正文：wait_threads 返回的完整 final 文本可直接归档；read_thread 主要用于核对 task ID、发送状态和补充可取得的输出，摘要或截断内容不能冒充完整回复。派发 prompt 要求 session 将完整数学结果原文保存到指定独立产物目录的 result.md，最终回复给出 task ID 和文件路径；正文未能完整从工具取得时，Main 直接读取该文件并连同真实回执冻结为 Evidence，不改写原文。文件缺失、来源不明或附件不完整时不能 returned，先完成结果回收。需审批、缺信息、取消、报错和无关回复不能当作研究完成。所有任务使用独立产物目录；只有 Main 更新共享研究状态、事实文章和接纳记录。

发送前核对 session 没有其他在途工作，不把研究任务排入无关繁忙任务。每项 prompt 指定独立产物目录 `research/results/<target>/round-<N>/session-artifacts/<task-id>/`。只等待本轮实际在途目标，不等待未参与本波次的 session；将 wait cursor 与工具回执保存到目标 state.json，研究 task ID 与宿主 threadId 分开记录。超时不是失败；用户输入、报错、审批或缺信息按真实状态处理，不增加新的用户审批步骤。此处是原交互流程的工具适配，不更改 grilling、轮次预算、补充派发、接纳和收尾规则。
