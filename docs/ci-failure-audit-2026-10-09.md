# CI 失败审计与修复（2026-10-09）

对应提交：`a5bd45c49906da94dd924220f8776f2d9f5638f6`。

- [Test 工作流](https://github.com/erocpil/nine-rings/actions/runs/37808238052)：Frontend 的单元测试/覆盖率通过，但依赖审计失败；Reading workspace Chromium 1 失败，WebKit 2 失败、1 flaky；完整 E2E 35 失败、2 flaky、12 跳过、847 通过。
- [Native Platforms 工作流](https://github.com/erocpil/nine-rings/actions/runs/37808238124)：Windows Chromium 通过；其余五个任务都在同一手机展陈首页布局用例失败。
- 同一提交的 CI 及 macOS ARM64、Linux、Windows Tauri 构建均成功。

## 第一批修复

1. 依赖安全审计：Vitest 与 coverage-v8 从 3.2.7 升至 4.1.11，兼容仓库 Node 22.23.3 和 Vite 6.4.3，无需采用审计建议的最新 5.x。更新现有约束内的 brace-expansion、source-map-js、DOMPurify 和 markdown-it。依赖仅安装在仓库 node_modules，锁文件记录具体版本。高危/严重由 2/2 降为 0/0，`npm audit --audit-level=high` 通过；仍有 1 低危、34 中危，未强制升级 TipTap/KaTeX 主版本。
2. 源码刷新恢复：父组件先于 lazy 源码编辑器挂载时没有拿到 handle，保存监听从未注册。现在 handle 就绪时重装监听，卸载时清理并保存；加密文档保持不持久化。测试轮询允许记录暂时为空，仍要求真实写入、刷新后精确恢复及返回渲染后不再自动打开源码。
3. 分栏键盘焦点：只在第一帧尝试焦点会遇到尚未解除 inert 的浮层。现在在有界时间内等待面板可接收焦点；Esc、卸载及用户已将焦点移到其它区域时取消。新增暂时 inert 的回归。悬停用例以实际面板的稳定几何进入内容，避免固定坐标落在动画中的正文上。
4. 手机展陈用例：不再依赖启动过程中短暂出现的欢迎页，等待默认文档加载后显式返回首页，再检查正方形、概览高度及横屏布局。
5. 大文档性能用例：原有固定矩形读取预算与新二分定位不符。改为按每帧两次 O(log n) 边界查找计算预算，保留对 O(n) 全文扫描的限制；`large-document-browsing` 已独立限制原生命中测试次数。

Vitest 4 使用更精确的 AST 覆盖率统计，揭示了原有加密备份校验分支缺口。补充有效路径/历史、重叠路径、身份不匹配及非法标签测试，保持门槛：statement 94.61%、branch 90.35%、function 97.36%、line 98.55%。64 文件 / 364 项通过。

最终 Chromium / WebKit 联合回归各 **20/20** 通过（覆盖源码/折叠刷新、手机首页、键盘焦点、悬停固定、边缘滚动条及千块文档）。此前 WebKit 扩大组 51 通过、1 个固定坐标悬停失败，改为进入实际动画面板后上述最终组通过。完整 `npm test`、typecheck、lint、format 和生产构建通过。未执行剩余 31 项失败用例的完整复现，也未重跑远端 CI。

本机日志及下载的原始 CI 日志分别位于 `.local-tools/ci-37808238052/` 和 `/tmp/nine-rings-ci-37808238*.log`。测试子集通过不代表远端 CI 或完整 E2E 已全部通过。

## 完整 E2E 的逐项清单

以下是工作流最终判定的 35 项，不把重试或另一个工作流中的重复用例再累计；除明确标注外，尚未区分产品缺陷与过期用例。

| 文件 | 用例 | 状态 |
| --- | --- | --- |
| `additional-interface-styles.spec.ts` | 纸页可选择、持久化、切换配色，源码行号保持等宽 | 待逐项复现 |
| `block-gutter-edit.spec.ts` | 桌面加号状态 › 不经过块号直接进入加号位置也显示对应块前后两个加号 | 待逐项复现 |
| `calm-desktop-layout.spec.ts` | calm 桌面基线、固定目录与窄正文留白 | 待逐项复现 |
| `calm-desktop-layout.spec.ts` | calm-compact 桌面基线、固定目录与窄正文留白 | 待逐项复现 |
| `calm-workspace-adaptive.spec.ts` | 导航键盘操作、无结果反馈、对比度与减少动画 | 待逐项复现 |
| `clipboard-paste.spec.ts` | 编辑器复制粘贴 › 长 shell 参数自动换行时不会让前导空格单独占据视觉行 | 待逐项复现 |
| `clipboard-paste.spec.ts` | 编辑器复制粘贴 › 编辑后的表格可规范化导出为 Markdown | 待逐项复现 |
| `code-block-modes.spec.ts` | Vim 退出插入模式后 Tab 仍缩进，组合键关闭弹层并回到正文 Windows | 待逐项复现 |
| `code-block-modes.spec.ts` | Vim 退出插入模式后 Tab 仍缩进，组合键关闭弹层并回到正文 Mac | 待逐项复现 |
| `context-menu.spec.ts` | 触控图片尺寸 › 拖动图片手柄调整尺寸并双击恢复 | 待逐项复现 |
| `document-comparison.spec.ts` | 右键菜单跨越分栏边界仍可点击，并能独立比较两篇文档 | 待逐项复现 |
| `epub-reader.spec.ts` | 本地 EPUB 可导入、阅读目录章节并恢复进度 | 待逐项复现 |
| `exhibition-workspace.spec.ts` | 手机展陈首页竖屏方形欢迎区、横屏并排且展开概览节省标题空间 | 本轮已修复并回归 |
| `heading-fold.spec.ts` | 千块文档全部展开后滚动不再逐块同步测量 | 本轮已修复并回归 |
| `interface-style.spec.ts` | 清雅采用完整预设，跟随系统；经典配置在切回后恢复 | 待逐项复现 |
| `line-numbers.spec.ts` | 编辑器块级 gutter › 块号输入后立即确认会同步 DOM 光标和模型选区（编辑） | 待逐项复现 |
| `line-numbers.spec.ts` | 编辑器块级 gutter › 块号输入后立即确认会同步 DOM 光标和模型选区（只读） | 待逐项复现 |
| `line-numbers.spec.ts` | 编辑器块级 gutter › 状态栏块号跟随光标并可独立关闭 | 待逐项复现 |
| `markdown-task-roundtrip.spec.ts` | 任务列表渲染、源码编辑与反复切换不累积转义 390 | 待逐项复现 |
| `path-actions.spec.ts` | 手机目录操作 › 点击目录计数选中并保留抽屉，顶部复制、取消删除、删除含子目录且不误删相似前缀 | 待逐项复现 |
| `path-markdown-export.spec.ts` | 路径递归导出 ZIP：桌面右键 | 待逐项复现 |
| `path-markdown-export.spec.ts` | 路径递归导出 ZIP：手机工具栏 | 待逐项复现 |
| `pwa-layout.spec.ts` | PWA 窄屏应用外壳 › 手机正文左移保留四位块号与折叠热区，代码右侧有留白 | 本轮已修复并回归 |
| `pwa-layout.spec.ts` | PWA 窄屏应用外壳 › 千块文档仅测量视口附近 gutter 且延迟快照仍会保存 | 本轮已修复并回归 |
| `reading-state-persistence.spec.ts` | 源码模式和源码视口跨刷新恢复，显式返回渲染后不再自动打开源码 | 本轮已修复并回归 |
| `session-restore.spec.ts` | 会话位置恢复与编辑器查找 › 重载后恢复文档树布局、目录视图和专注模式 | 待逐项复现 |
| `session-restore.spec.ts` | 会话位置恢复与编辑器查找 › 切换移动文档列表保留侧栏的目录折叠状态 | 待逐项复现 |
| `session-restore.spec.ts` | 会话位置恢复与编辑器查找 › 专注模式中文档查找浮层可见且在主窗口关闭时同步关闭 | 待逐项复现 |
| `settings-navigation.spec.ts` | 编辑器状态栏紧凑且可以关闭并持久化 | 待逐项复现 |
| `sidebar-colors.spec.ts` | 分栏导航和工具栏跟随主题背景，保留选中反馈 | 待逐项复现 |
| `style-preview.spec.ts` | 风格预览跟随深浅配色，桌面四列，旧紧凑配置仍可识别 | 待逐项复现 |
| `toolbar-more-overflow.spec.ts` | 更多菜单跟随实际工具溢出，不重复工具栏入口 | 待逐项复现 |
| `toolbar-responsive.spec.ts` | 响应式编辑器工具栏 › 默认桌面窗口和表格上下文均不产生水平滚动 | 待逐项复现 |
| `toolbar-responsive.spec.ts` | 响应式编辑器工具栏 › 表格支持连续选择、触屏友好的行列选择和列宽持久化 | 待逐项复现 |
| `ui-polish.spec.ts` | 新建表单校验路径，添加标签不提交，创建失败可重试 | 待逐项复现 |

另有 flaky：正文右键菜单、固定分栏/书签重载；Reading workspace WebKit 另有边缘滚动条 flaky。后续先按颜色/布局断言、工具栏和状态栏入口、移动路径抽屉及编辑导出分组复现，不直接删用例或提高超时。
