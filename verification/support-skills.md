# 支持技能适配检查（2026-09-18）

基线：7e2f3f6614b6dd2c0b9ebb5666267b2af4f50001。

新增发行技能 dictionary 与项目级维护技能 issue。Dictionary 使用本版来源索引，解释职责、配置、轮次、接纳和产物，区分合同与实际验证；Issue 按当前 remote 发布工程需求，保留草稿确认，查重分页并通过正文文件传递内容。

检查结果：

- 17 个发行技能的结构及链接检查通过；Issue 单独核对项目级链接与 YAML。
- 新增来源索引、README、使用说明和 Issue 约定的本地链接有效。
- 新增 YAML 可解析，差异空白检查通过。
- run-math、ROUND-WORKFLOW、ARTICLE-WORKFLOW 与基线逐字一致。
- 未修改数学 runtime，未重复运行已有 192 项回归；这些旧结果不作为新增技能行为测试。
- 未调用真实研究 session 或发布测试 Issue；查询质量及 GitHub 实际写入仍需按具体用户请求验证。
