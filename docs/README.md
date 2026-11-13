# 文档导航

当前行为以源代码、测试和当前契约为准；带日期的审查、测量及阶段报告只说明当时状态。归档方案不表示已经实现。

| 分类 | 内容与入口 |
| --- | --- |
| [架构](architecture/) | [关键设计](./architecture/current-design.md)、[工程设计地图](./architecture/engineering-design-map.md)、[统一文档工作区](./architecture/unified-document-workspace.md)、[数据边界](./architecture/document-data-boundaries.md) |
| [功能契约](features/) | [功能规格](./features/features.md)、[Markdown 兼容性](./features/markdown-compatibility.md)、[源码语言](./features/document-source-languages.md)、[本地文件夹工作区](./features/local-folder-workspace.md) |
| [插件](plugins/) | [插件设计](./plugins/plugin-system-design.md)、[安装契约](./plugins/plugin-package-installation.md)、[展示扩展](./plugins/plugin-panel-presentation.md) |
| [同步与备份](sync/) | [手动同步指南](./sync/incremental-sync.md)、[人工验收](./sync/sync-manual-validation.md)、[发布恢复](./sync/sync-publication-recovery.md) |
| [开发与平台](development/) | [本地工具链](./development/local-toolchain.md)、[Tauri 构建](./development/TAURI_BUILD.md)、[Flutter 构建](./development/FLUTTER_BUILD.md)、[经验总结](./development/lessons-learned.md) |
| [验证记录](validation/) | [E2E 策略](./validation/e2e-suite-policy.md)、[测试审查](./validation/test-suite-audit-2026-11-04.md)、[回归进度](./validation/e2e-repair-progress.md) |
| [计划](planning/) | [工程计划](./planning/engineering-improvement-plan.md)、[File Workbench 待办](./planning/file-workbench-followups.md)、[编辑器后续](./planning/editor-followups-2026-09-17.md)、[架构审查候选](./planning/architecture-analysis.md)；插件与同步的当前交付状态另见[总待办](./plugins/plugin-readiness-todo.md) |
| [决策](decisions/) | 架构决策记录，保留背景、备选方案与约束 |
| [示例](examples/) | 可直接使用的配置示例 |
| [未来方向](future-evolution/) | 尚未承诺实现的研究与产品演进 |
| [归档](archive/) | 早期方案和历史评估，仅供追溯 |

新增文档放入对应分类，避免继续平铺在 docs 根目录。移动文档时同步修改 Markdown 链接、README、AGENTS、脚本及测试中的路径；文件名保持稳定，方便历史检索。
