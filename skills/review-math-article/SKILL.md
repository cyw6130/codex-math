---
name: review-math-article
description: 独立审核事实增量、文章整合、初始化汇编或派生论文，使用 fact-increment、article-integration 或 whole-article 范围，输出绑定准确候选的真实报告。
---

通过符号链接安装时，先解析本 SKILL.md 的真实路径。相对资源依此真实路径读取；套装 tools/、runtime/、vendor/ 位于实际 skills/ 的上一级。

# 独立文章审核

已发布账本纯编辑修订使用 article-integration，按文章接口的 editorial-packet 核对旧全文、候选及原接纳依据，不要求新的数学 Commit。除有效内容保留外，核对主要陈述位置、合并的适用范围、总览和开放边界是否同步、跨节引用是否唯一；节内公式编号允许重复。只对本次变化及影响作新检查，不以既有局部 pass 拼造全文数学 pass。

调用方必须指定 scope；whole-article 还需说明 purpose，既有派生论文调用缺省为 derived-paper。

- `fact-increment`：读取 [事实审核](references/fact-review.md) 和 [文章接口](../shared/ARTICLE-WORKFLOW.md)，审核冻结候选的增量数学正确性及受影响的全文一致性，输出原生回执。它是本轮增量的数学接纳审核；修改内容时对新候选定向复核，不因审核次数增加推理轮。
- `whole-article`：purpose=derived-paper 时读取 [全文标准](references/whole-article.md)，沿用派生论文的事务、材料快照和修订绑定；purpose=initial-facts 时读取 [文章内容规范](../shared/ARTICLE-CONTENT.md)，审核汇编候选的数学忠实性、完整覆盖与跨章节一致性，输出绑定准确全文和输入哈希的报告及复用/新检查/未解决项。初始化分支不要求 run-math 完成状态、Commit 或派生论文事务，不执行提升；交 initializing 登记实际审核来源。已有准确适用报告可复用，不重审相同交付。
- `article-integration`：Main 判断需要独立视角或仍有疑点的整合，Commit 后对完整事实文章核对整合忠实性与完整性；逐项检查已接纳增量是否正确落实、旧有效内容有无遗漏、条件与证明状态有无改变、必要定义和证明是否在正文。依据冻结旧文、已接纳增量和新全文，使用文章接口的 article-packet/update-article 与真实原生回执。发现新数学缺口先交 Main 修订，不由审核者补证，不把该核对当成新的数学接纳。

独立性针对实际审核对象：fact-increment 回避本次候选作者及本次需重审的旧结论作者；article-integration 回避本次增量与整合写作者；whole-article 回避所审核全文作者。历史上参与过无关或本次仅复用内容的人不自动排除。Main 选择合适审核者并补充实际回避身份，使用真实平台身份；默认 Sol/medium。只向审核者传准确候选、必要来源、既有审核及标准，不继承作者过程。审核者只写报告，不改正文，不补新证明或执行提升。Main 先判断意见：误读先澄清，表达问题集中修改，数学问题才修订增量；不为每条意见单独建包。实际送审前冻结候选；改过的文本不能沿用旧包的通过回执。Main 修订后优先回到同一 Sol，对新包和受影响依赖定向复核；旧报告只有未改且依赖有效的部分可复用，新结论仍绑定新包。Main 判断误读与实质分歧，需要时再请另一 Sol；不得为了得到通过而反复换审核者。

各 scope 的审核复用与旧新位置对应统一读取 [文章内容规范](../shared/ARTICLE-CONTENT.md) 的“材料与审核复用”；article-integration 同时读取“增量维护”。事实审核复用已审核未改且依赖仍有效的内容，派生论文全文审核按其范围执行。旧 math-core 调用应迁移为 fact-increment 审查包，不能拿旧宽松报告直接执行 accept。报告与候选不匹配时停止。新发起的独立审核须保留真实原生记录，不能取得时明确阻塞；初始化复用既有审核依文章接口保存可核实的原报告与 provenance，不追造历史 native Commit 回执。

调用方按 [轮次合同](../shared/ROUND-WORKFLOW.md) 用原生完成通知或有界等待接收结果，完成后 Main 立即继续，不默认等 15 分钟 heartbeat。审核者保持只读候选、只写报告；恢复先查实际已完成审核，避免重复派审。
