# 维护约定

本仓库为 Codex session 数学研究工作流，入口 setup-math/run-math。先读 README.md 和 skills/shared/ 合同。保持 run-math 交互设计，仅在明确需求下修改。不得把模型候选当作数学接纳；保留独立审核与证据归档。

## 支持入口

- dictionary 是只读系统术语入口，来源索引在 skills/dictionary/references/source-map.md。改动相关合同后只更新受影响的来源指针，不创建第二份定义。
- issue 是项目级工程维护技能，位于 .agents/skills/issue/；操作前读取 docs/agents/issue-tracker.md。它不进入研究调度，也不自动随研究成果创建 Issue。

## 公开发布范围

对外文档只介绍 Codex Math 的定位、功能与用法。不得提交未经授权的开发来源、私人研究笔记、本机路径或其他内部资料；发布前检查所有待发布文件及 Git 历史，不仅检查 README。第三方许可证与必要署名必须保留。
