# 开发会话交接

更新：2026-11-20。此文件是接续入口，不是完整待办清单；开始任务前以当前分支、工作区和代码核对本文。不要把“下一步”理解为未经用户指定就启动全部历史待办。

## 开始顺序

1. 读取仓库 `AGENTS.md` 和本机 `nine-rings-development` skill，检查 `git status --short`、当前分支和最近提交。保留用户未提交内容。
2. 按任务查阅[统一文档工作区](../architecture/unified-document-workspace.md)、[内容权威模型](../architecture/editor-authority-and-workspace.md)或[Workbench 待办](../planning/file-workbench-followups.md)。裸文档名先用 `rg --files docs` 定位。
3. 确认受影响宿主、来源、视图和权限，以及既有持久化与测试入口。无需重新读取整段历史聊天或把所有旧待办重新执行。
4. 先实现用户指定任务；提交／推送以当前授权为准。本文不授权远端写入、发布、备份清理或真实用户数据操作。

## 最近交付

| 提交 | 已完成内容 |
| --- | --- |
| `94f7cafc` | Workbench 未命名文档、本机草稿持久化、首次保存选择位置、编辑标签及窗口召回。 |
| `1007da5b` | 退出保留磁盘／未命名文件打开清单，恢复顺序与活动项，保留按文件显示偏好。 |
| `cb00bc22` | 共享选区工具、右键原选区保护、子菜单期间父层保持可见；文件定位复用目录标签、失焦误触保护及有界诊断。 |
| `db1f5830` | Workbench 更多工具展开状态持久化，源码／渲染及窗口同步。 |
| `20473822` | 状态栏折叠菜单加入渲染正文折叠图标可见性，与源码复用操作、分别记忆；完整／局部只读及 Workbench 均接入。 |

## 当前应保留的约束

- 两款应用复用 `RenderedDocumentWorkspace`、`DocumentSourceSurface`、`DocumentNavigationWorkspace` 及公共菜单／标题／状态栏，差异由宿主能力与文件服务注入。不要再次维护一套 Workbench 专用 Markdown 渲染器。
- 退出应用／窗口保留打开清单；主动关闭文件才删除清单项。未命名草稿、磁盘原文、只读与源码／渲染显示偏好分别维护；取消保存及关闭不得丢内容。
- 显示设置不能写正文、增加编辑撤销步骤或重置折叠。渲染隐藏折叠图标时回收块间加号控制列。插入入口在块号菜单，块号也隐藏时通过标题栏打开当前块菜单。工具栏及菜单仍可展开，目录自身的折叠图标继续显示。
- 原生选区绘制、ProseMirror／CodeMirror 选区、右键菜单焦点要分别核对。WebKit 可在 contextmenu 前重新选择点击单词；只检查 Chromium 不足以证明原选区保留。
- Esc／Left 在级联菜单中逐层返回。浏览器测试应确认按钮的 `aria-expanded` 及菜单层级，不假设一次 Esc 就关闭整条菜单链。
- `useFocusEditorTools` 的 Workbench 持久化由 `src/apps/file-workbench/toolbar-preferences.ts` 装配；保持 Nine Rings 原策略。`nr:blockWorkspaceDisplay` 继续维护软换行、高亮、微渲染及编号相关共享偏好。

## 编辑器设置接续

- Nine Rings 编辑器设置与 Workbench 的标题栏设置通过 `EditorSettingsContent` 复用，排版继续使用 `EditorAppearancePanel`。Workbench 单独保留源码字体及配色，配置应用于磁盘文件与未命名文档；浏览窗口保留配色入口。
- 固定目录／书签可以独立占满侧栏高度。文档状态栏与正文列的分隔线沿用 `document-rail.ts`，后续若增加窗口级信息可另设跨列区域。Workbench 相对 Markdown 链接的实测样本和实现边界见[后续待办](../planning/file-workbench-followups.md#markdown-路径跳转检查与更新)。
- 本批通过 `npm run check`（Vitest 2743 项）、两套前端生产构建、Nine Rings 相关 Playwright Chromium 45 项与 WebKit 串行 8 项，以及 Workbench 定向 Chromium／WebKit 各 7 项。跨窗口测试通过同一浏览器环境和模拟 Tauri 桥接运行，安装版仍待验收。

## Markdown 跳转验证

磁盘路径解析、源码和渲染标题定位、Workbench 跨标签返回、断链修复，以及同一授权根内改名后的预览写入均有定向回归。验证包括原有文件版本变化后拒绝覆盖、未保存来源标签保留、只读与可编辑模式及中文锚点。IELTS 实际示例只读验证定位到核心库「5.1 教育（Education）」。测试使用浏览器和模拟 Tauri，安装版 GUI 保留独立验收。

## 尚未确认与后续入口

- **已定位 Workbench 右栏副本的直接原因。** 本机记录先恢复四对四个标签，随后 `reveal-file` 将右栏增为五个。旧定位只查活动栏，因此给左栏已有目录另开了一项。定位现在按活动侧优先查找两侧可见行；首次读取旧状态时，只清理诊断与旧定位生成形态均能核实的末尾副本。
- `directory-tab-events` 最多 40 条，保留动作来源、时间、数量和活动侧。原生权限弹窗与定位请求之间是否有因果关系仍待实测。显式「＋」创建的同路径标签和已修改的副本继续保留。
- 安装版进程退出／启动、系统保存／授权对话框和真实 Command+Tab 仍需人工验证。模拟 Tauri 桥接与浏览器重载不能替代这些验收。
- 独立 Editor 应用身份仍是设计待办；当前独立窗口不等同独立 app／进程。后续需先设计授权、写入租约、草稿身份与退出协调，见 Workbench 待办。

## 验证基线与命令

`20473822` 本地通过 `npm run check`（类型、ESLint、格式、既有脚本、Vitest、覆盖率及 IPC；Vitest 262 文件／2725 项）、`npm run build` 和 `npm run build:workbench`。这是当时结果，不是新修改后的保证。

折叠设置回归：

```sh
npx playwright test e2e/editor/rendered-status-gutter.spec.ts --workers=1
npx playwright test --config=playwright.workbench.config.ts --grep 'Markdown 渲染状态栏共用'
```

两条命令各加 `--browser=webkit` 复核。该批 Chromium 6 项、WebKit 6 项通过，覆盖经典／清雅、普通／局部只读和 Workbench 只读／可编辑；验证可见性、重载、偏好独立、正文不变。**并未运行完整产品 E2E、安装版 GUI 或本提交远端 CI。**

单元入口：`tests/unit/block-display-settings.test.ts`、`workbench-toolbar-preferences.test.ts`、`workbench-editor-window.test.ts`、`workbench-buffer-documents.test.ts`。不要把这些测试的历史统计相加当作全量回归。

Playwright 独立套件使用不同输出目录；并发使用默认 `test-results` 会互相清理 trace。共享端口 8000 的套件串行运行；Workbench 专用 config 使用 1421。服务器／浏览器或 tsx IPC 因沙箱 EPERM 失败时按环境要求申请执行权限，不修改应用来绕过沙箱。

建议新会话开场：

> 继续 Nine Rings／File Workbench。先读 AGENTS.md、nine-rings-development skill 和 docs/development/session-handoff.md，核对分支与工作区；上次功能提交 20473822。下一项任务：……。提交／推送要求：……。
