# 测试套件精简审查（2026-11-04）

## 范围与依据

核对 package.json、Vitest、Playwright 全部配置、CI 工作流与 affected-suite 选择器；盘点 220 份 Vitest 文件、45 份 tests 根目录脚本测试、331 份 E2E 文件。检查同名测试、测试层级、诊断开关及分组归属。此为套件结构审查与已确认候选项的内容审查，不代表逐行证明全部测试不存在冗余。

## 已精简

- `tests/document-diff.test.ts` 只覆盖 800 行文档插入一个空行。将全部五个断言迁入现有 `tests/unit/document-comparison.test.ts`，删除独立脚本及 npm test 中对应的 tsx 进程。该回归仍由 `npm run test:coverage` 和 `npm run check` 执行；不能只运行 `npm test` 来代替完整检查。
- 7 份显式性能诊断从默认 E2E 和 CI 计划中分离，默认发现数从 1595 降至 1582。减少的是 13 个未启用的诊断项，不减少功能回归。生产诊断之前也会被默认开发服务器发现，其运行环境现由专用配置明确指定。
- 开发态编辑器/搜索诊断使用 `playwright.benchmark.config.ts`；生产编辑器与只读诊断继续使用已有 `playwright.editor-benchmark.config.ts`、`playwright.readonly-benchmark.config.ts`。原有环境变量开关仍保留；相关文档命令已更新。

## 保留理由

- 本地日期的补零格式测试和跨时区测试验证不同条件，保留两者。
- Markdown 解析、序列化与浏览器粘贴分别验证纯函数和真实编辑器事务；不能因输入文本相似而删掉其中一层。
- 数据库/磁盘、源码/渲染、编辑/只读、手机/桌面及 Chromium/WebKit 覆盖不同适配、布局和事件路径，保留独立回归。
- 真实 CDP 触摸、page.pdf、Service Worker 等浏览器能力限制导致的跳过有明确原因，未通过删除用例隐藏。
- 现有 Reading、WebKit 与生产门禁已有分组所有权检查；保持其覆盖，不将跨平台执行误判为重复。

## 验证及影响结论

完整 `npm run check` 通过，包括原脚本测试、全部 Vitest、类型、lint、格式和 IPC；覆盖率门槛未降低。文档对比 Chromium E2E 6/6 通过。默认 E2E 完整发现检查通过；三个诊断配置分别仍能发现 6、3、4 项。生产构建通过，仍有 source-formatting.ts 同时静态/动态导入的既有提示。本批未重跑 1582 项完整功能 E2E。

影响结论：功能断言迁移和默认发现范围的改变有上述验证支持。对整个测试库是否仍存在语义冗余，结论为 UNCERTAIN；后续删除应提供原用例与保留用例的逐项对应，并结合实际耗时报告确定收益。本批没有根据测试失败删用例，也没有更改产品实现。
