# GitHub Issue 约定

本仓库工程想法、设计与变更通告使用 GitHub Issues。研究成果的数学接纳仍按 skills/shared 合同，Issue 不是数学事实来源。运行时从当前仓库 remote 解析 owner/repo，禁止误写源 Skill OS 仓库。

- 使用 gh CLI，只读查询不修改 Issue。
- 查重用 GitHub Issues API 的 --paginate，过滤 pull_request，读完全部开放项；对相关项读取完整正文及评论。不要把 gh issue list 默认一页当成全部。
- 显式调用 issue 后先整理草稿，按技能完成真实发布确认再创建或评论；批准新建不代表批准改写旧正文或负责人。
- 多行正文用临时 UTF-8 文件和 --body-file，保留用户实际确认的内容。
- 新想法/设计只加 needs-triage，不设置 assignee。已完成变更新建独立 open Issue，使用 change-notice，正文只提及已确认的协作者。
- 发布前查询标签；若所需标签不存在，可在用户已明确批准该次发布后创建该必需标签，不额外改变其他仓库设置。
- 请求结果不确定时先核查，不盲目重试。

标签及职责见 [标签说明](triage-labels.md)。本技能不创建 PR、不实施需求、不自动触发研究或数学 Commit。
