---
name: initializing
description: 从确认并有审核依据的数学文章建立可迁移事实工作区，或恢复已有工作区。
---

通过符号链接安装时，先解析本 SKILL.md 的真实路径。相对资源依此真实路径读取；套装 tools/、runtime/、vendor/ 位于实际 skills/ 的上一级。

# 初始化或恢复

读取 [文章接口](../shared/ARTICLE-WORKFLOW.md) 和 [轮次合同](../shared/ROUND-WORKFLOW.md)。ROOT 默认项目 facts/，多工作区由调用者明确；已有 workspace.json 时只 status 并恢复，不重复初始化。

先读取调用方已确认的材料选择与范围，再定位用户指定的准确文章、来源和真实审核。没有材料选择时先问是否使用本地研究文件，不因目录中存在材料就汇编；用户明确指定初始化材料时不重复问。调用方若仅完成配置、尚待 run-math 讨论研究起点，返回调用方，不擅自创建基线。无既有材料的新研究只使用已确认的目标、约定和来源，不重新导入用户已排除的本地文件。

已有准确完整文章和有效审核时直接复用；文章完整但缺少适用审核时，直接审核准确全文而不重建；来源尚未汇编时读取 [文章内容规范](../shared/ARTICLE-CONTENT.md) 的“首次汇编”，以选定的成熟母稿、有效结果与必要来源组织完整候选，再交 review-math-article（scope=whole-article，purpose=initial-facts）审核。尚无成熟成果的新项目仅组织已有数学、目标、定义、约定与开放边界，不补新证明。确认基线时复用已有授权；初始化授权与按轮自动 Commit 授权分别记录。

已有与准确文章对应的地图和来源检查时复用；缺失时用本套装 to-map 提取该准确文章。已有真实独立地图审核可复用，否则初始化 provenance 标 map_review=not-run；需要独立地图审核时初始化后走 map-packet --current 分支，不能伪造 passed。

复制套装 runtime/ 的 article_flow.py、native_audit.py、round_flow.py、dispatch_log.py、view_data.py 到 ROOT/.workflow/，保存轮次合同、文章接口合同及 ARTICLE-CONTENT.md；保留供审核调用读取的套装真实路径，复制到工作区的合同仅作版本记录，相对 skill 引用仍从原套装解析。依文章接口准备真实 provenance 与审核原文，initialize 登记准确文件并运行 links、status。ROOT 不存在时先创建。

article_flow.py 和 native_audit.py 在 shared/ 有与 runtime/ 一致的副本供原接口迁移。运行时只使用 workspace 指向的版本；必要来源冻结到 ROOT 内。报告基线登记和地图审核的真实状态；不构造历史 Attempt。
