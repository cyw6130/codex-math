# 参与贡献

欢迎通过 Issue 报告问题或提交 Pull Request。请说明使用环境、复现步骤和预期行为，不要上传真实任务 ID、凭证或未授权研究材料。

保持 run-math 的既有交互与数学接纳边界。修改技能时同步相关引用；修改运行时后执行：

```sh
python3 tools/check_suite.py
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
```

测试结果不替代真实宿主测试或独立数学审核。请在变更说明中区分已验证与尚未验证的部分。
