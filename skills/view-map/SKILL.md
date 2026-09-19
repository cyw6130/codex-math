---
name: view-map
description: 只读解析当前已发布数学地图并调用已有交互阅读器；核对版本、哈希与待发布状态，不生成新前端。
---

通过符号链接安装时，先解析本 SKILL.md 的真实路径。相对资源依此真实路径读取；套装 tools/、runtime/、vendor/ 位于实际 skills/ 的上一级。

# 查看数学地图

从 workspace 指向的 runtime 定位同目录 view_data.py，或使用本套装 runtime/view_data.py。运行 `python3 VIEW_DATA ROOT --kind map`，得到经哈希验证的 map_path、来源 paper_path、地图 revision、article_revision、latest_article_path、map_stale 和 publication_pending。展示时明确“地图来自文章 vM，最新事实文章 vN”；map_stale 时说明地图尚未追上文章，并给最新文章入口。pending 只表示仍有文章增量待整合；不能以 pending 为空推断地图已经同步，不把候选图当当前图。

读取环境中实际 map-view 技能及阅读器配置。mapReaderRoot 优先采用项目显式配置，否则只在已知安装位置定位并核对。用本套装 `node tools/open-map-view.mjs READER_ROOT MAP_PATH --check` 检查 server.js、graph:view 与实际页面位置；校验后去掉 --check 启动原有阅读器。从进程实际输出取得 HTTP URL，在 Codex 浏览器中打开，复用同一输入的既有服务/标签。

该适配允许页面位于 pages/pure-graph-view.html 或根目录，解决原技能文档的路径漂移；使用原项目 npm run graph:view，不依赖 rtk 包装。不猜 URL，不另造前端。

验收图可见、无错误、能拖动缩放和查看节点详情。阅读器缺失时报告实际缺失路径。查看不改图、不接纳数学、不触发研究。开放问题和条件性结论的图状态按总稿解释，不能因文章审核通过而宣称全图已证明。
