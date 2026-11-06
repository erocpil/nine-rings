# 浏览器测试目录

| 目录 | 主要覆盖 |
| --- | --- |
| `editor/` | 源码、Markdown、结构块、选区、折叠、粘贴与编辑器行为 |
| `workspace/` | 文档树、工作区、设置、布局、菜单和会话导航 |
| `local-files/` | 本地文件授权、操作、恢复及源码适配 |
| `readers/` | PDF、EPUB、图片及阅读资料库 |
| `plugins/` | 插件宿主、参数、展示及包安装 |
| `data/` | 数据安全、导入导出、同步、加密与恢复 |
| `delivery/` | PWA、生产构建和按需启用的性能诊断 |
| `helpers/`、`fixtures/` | 跨功能组复用的夹具与浏览器操作 |

文件名是 CI 分组的稳定身份，整个 e2e 树中必须唯一。`scripts/e2e-suites.mjs` 递归发现文件并拒绝重名；公共 helper 改动仍选择完整套件。按职责移动时要更新相对导入、脚本及文档路径，并比较迁移前后的完整用例清单。

```sh
npx playwright test e2e/editor/source-vim.spec.ts --workers=1
node scripts/run-e2e-ci.mjs --plan
```

开发、生产、阅读、原生平台与诊断门禁继续由根目录的 Playwright 配置及 CI 分组确定；所在目录不自动代表会在默认环境执行。
