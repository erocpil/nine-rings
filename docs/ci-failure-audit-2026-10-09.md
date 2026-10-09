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

最终 Chromium / WebKit 联合回归各 **20/20** 通过（覆盖源码/折叠刷新、手机首页、键盘焦点、悬停固定、边缘滚动条及千块文档）。此前 WebKit 扩大组 51 通过、1 个固定坐标悬停失败，改为进入实际动画面板后上述最终组通过。完整 `npm test`、typecheck、lint、format 和生产构建通过。这是第一批提交时的验证快照；后续逐项结果见下方第二批。远端 CI 尚未重跑。

本机日志及下载的原始 CI 日志分别位于 `.local-tools/ci-37808238052/` 和 `/tmp/nine-rings-ci-37808238*.log`。测试子集通过不代表远端 CI 或完整 E2E 已全部通过。

## 第二批：剩余用例逐项修复

第一批已提交为 `b7d7b3a`。按原 CI 清单复现后，修复如下：

- 产品布局：首块插入按钮的中心留在正文边界内，保持正文留白及与折叠按钮的分离；悬停测试明确命中固定工具栏下方的可见区域；状态栏日志按钮外层改为 inline-flex，消除字体基线的额外高度；流程块菜单补齐图标。
- 可读性：清雅辅助文字从 `#586953` 微调至 `#53644e`，文档计数在选中背景上的对比度由 4.43 提高到 4.5 以上。纸面、字体及字号保持不变。
- 过期断言：纸页/清雅颜色、舒适默认密度、紧凑块号文本和只突出图标的分栏选中态按当前设计检查。手机选路径应收回抽屉；路径工具操作先重新展开，而不是要求保留抽屉。
- 工具入口：代码、图片、表格及 Markdown 导出复用实际可见工具栏的直达/分组/更多入口；不以固定视口宽度推断分组。仍验证插入、尺寸调整、导出文件内容、表格选择与列宽保存。
- 初始化与异步状态：Vim 输入前等待 CodeMirror 焦点及 NORMAL 模式；源码循环等待完整任务源码；目录折叠只操作有子项的目录，移动用例明确创建 projects 文档；关闭设置和退出专注模式后等待实际状态。新建失败替身只计目标表单，排除异步示例文档初始化。
- 语义定位与快捷键：提示按内容定位，避免保存状态的第二个 status 造成严格模式冲突；跨平台文档查找使用 Alt+F，保留非 Mac 浏览器 Ctrl+F 的原生行为。

原 CI **35 个最终失败 + 2 个 flaky** 的完整定向组：Chromium **37/37**、WebKit **37/37**，均无重试、无跳过。初次本地复现 23 失败 / 13 通过，漏入的固定布局 flaky 已补入最终 37 项；没有据此删除用例。原表中四位块号手机用例被误标为第一批完成，现已在本批双浏览器实际验证，并补齐视图状态等待。

扩大到完整 Chromium 后，第一轮为 **870 通过、15 失败、12 跳过**，无 flaky（897 项，20.7 分钟）。原 CI 清单未再失败；新增失败继续处理如下：

- 阅读器用例在默认文档初始化完成前打开 PDF/EPUB，随后被迟到的启动选择切回文档。等待初始编辑器就绪后再验证全屏、目录加载/失败与中断。
- 富文本选区会重新计算工具栏宽度：复制/粘贴同时适配直达、分组和更多，并等待排布后的真实入口。
- 手机底部留白用例以实际收回按钮关闭抽屉，避免固定坐标落到正文上。
- 首块加号不移入标题折叠热区；悬停命中其实际可见部分，并保留触摸插入及全部控件同轴断言。
- 长文档初始化的异步 `page.evaluate` 经 Chromium 协议日志确认是 `Promise was collected`，并非真实页面导航。创建完成后安排下一任务挂载，先完成 CDP 返回，再等待正文布局；未忽略异常或重试操作。

第二轮完整回归为 **884 通过、1 失败、11 跳过**（15.8 分钟）。唯一失败并非专注状态丢失：QuickTooltips 在悬停期间临时移除原生 `title`，而同一用例重复点击时依赖 `getByTitle`，导致找不到按钮。该用例改用实际保留的无障碍按钮名称；Chromium 同条件 2 workers 连续 8 次、WebKit 连续 3 次通过。极窄屏更多菜单同时等待旋转后的实际几何提交，不放宽边界断言。

已清理永久跳过的旧独立专注工具栏用例；当前统一标题栏由 `mobile-unified-title.spec.ts` 覆盖编辑/只读/局部只读、横竖屏、手势和键盘布局。保留的 11 项跳过均为 `NR_EDITOR_BENCHMARK` / `NR_READONLY_BENCHMARK` / `NR_SEARCH_BENCHMARK` 显式启用的性能诊断。最终完整 Chromium E2E **885 通过、11 性能基准跳过、0 失败、0 flaky**（896 项，14.8 分钟），使用 2 workers / 1 retry，实际没有触发重试。原 CI 35 失败及 2 flaky 均已消除。WebKit 联合回归 **57 通过、2 项既有原生剪贴板能力跳过**，统一标题栏另 **5/5** 通过，最终四位块号稳定性另 **3/3** 通过。未删除失败用例或放宽超时/边界/性能预算。远端 CI 及 Linux/Windows 原生矩阵尚未重跑。该结果是后续 Markdown 导入调整前的完整验证快照。`npm test`、Vitest 64 文件 / 364 项、typecheck、lint、format、生产构建通过；覆盖率仍为 statement 94.61%、branch 90.35%、function 97.36%、line 98.55%，构建无大 chunk 警告。最终回归工具使用仓库隔离目录，未安装全局软件。

## 后续 Markdown 修复的独立验证

完整 885 项通过的快照之后，另根据用户实际导入反馈修复引用列表结构、行内代码辨识度、列表后源码空行与代码块号/类型标识，并补齐嵌套引用的源码位置权重。此次最终相关 Chromium 整组 **99/99** 通过，WebKit 分组去重后 **51 项** 通过（最终导入/源码组 **10/10**）；两项原生复制用例改为在实际可见正文中进行真实拖选，保留模型及系统剪贴板精确断言，重复验证 **10/10** 通过。完整单元测试及 Vitest **65 文件 / 372 项**、类型/lint/format、构建通过。

这些是原 CI 整理之后新增的产品修复及定向回归，不能把先前 885 项完整通过视为新 Markdown 修改后的完整报告。详情见 [E2E 进度](e2e-repair-progress.md#2026-10-09引用-markdown-与源码边界回归)，日志位于 `.local-tools/markdown-quote-review/`。远端 CI 和 Linux/Windows 原生矩阵仍未重跑。

## 本地完整回归命令

```sh
PLAYWRIGHT_JSON_OUTPUT_FILE=.local-tools/ci-37808238052/full-chromium-verified.json \
  bash scripts/with-local-tools.sh npx playwright test \
  --workers=2 --retries=1 --reporter=line,json --trace=retain-on-failure \
  --output=.local-tools/ci-37808238052/full-chromium-verified
```

报告与诊断均在被忽略的 `.local-tools/` 内。WebKit 的联合清单配置也保存在该目录，仅用于本轮复现；仓库测试仍使用正式的默认/平台配置，未调整重试次数、超时或性能门槛。

## 完整 E2E 的逐项清单

以下是工作流最终判定的 35 项，不把重试或另一个工作流中的重复用例再累计；状态由下方第二批本地回归更新，历史 CI 用例名称保留以便与日志对应。

| 文件 | 用例 | 状态 |
| --- | --- | --- |
| `additional-interface-styles.spec.ts` | 纸页可选择、持久化、切换配色，源码行号保持等宽 | Chromium / WebKit 已回归 |
| `block-gutter-edit.spec.ts` | 桌面加号状态 › 不经过块号直接进入加号位置也显示对应块前后两个加号 | Chromium / WebKit 已回归 |
| `calm-desktop-layout.spec.ts` | calm 桌面基线、固定目录与窄正文留白 | Chromium / WebKit 已回归 |
| `calm-desktop-layout.spec.ts` | calm-compact 桌面基线、固定目录与窄正文留白 | Chromium / WebKit 已回归 |
| `calm-workspace-adaptive.spec.ts` | 导航键盘操作、无结果反馈、对比度与减少动画 | Chromium / WebKit 已回归 |
| `clipboard-paste.spec.ts` | 编辑器复制粘贴 › 长 shell 参数自动换行时不会让前导空格单独占据视觉行 | Chromium / WebKit 已回归 |
| `clipboard-paste.spec.ts` | 编辑器复制粘贴 › 编辑后的表格可规范化导出为 Markdown | Chromium / WebKit 已回归 |
| `code-block-modes.spec.ts` | Vim 退出插入模式后 Tab 仍缩进，组合键关闭弹层并回到正文 Windows | Chromium / WebKit 已回归 |
| `code-block-modes.spec.ts` | Vim 退出插入模式后 Tab 仍缩进，组合键关闭弹层并回到正文 Mac | Chromium / WebKit 已回归 |
| `context-menu.spec.ts` | 触控图片尺寸 › 拖动图片手柄调整尺寸并双击恢复 | Chromium / WebKit 已回归 |
| `document-comparison.spec.ts` | 右键菜单跨越分栏边界仍可点击，并能独立比较两篇文档 | Chromium / WebKit 已回归 |
| `epub-reader.spec.ts` | 本地 EPUB 可导入、阅读目录章节并恢复进度 | Chromium / WebKit 已回归 |
| `exhibition-workspace.spec.ts` | 手机展陈首页竖屏方形欢迎区、横屏并排且展开概览节省标题空间 | Chromium / WebKit 已回归 |
| `heading-fold.spec.ts` | 千块文档全部展开后滚动不再逐块同步测量 | Chromium / WebKit 已回归 |
| `interface-style.spec.ts` | 清雅采用完整预设，跟随系统；经典配置在切回后恢复 | Chromium / WebKit 已回归 |
| `line-numbers.spec.ts` | 编辑器块级 gutter › 块号输入后立即确认会同步 DOM 光标和模型选区（编辑） | Chromium / WebKit 已回归 |
| `line-numbers.spec.ts` | 编辑器块级 gutter › 块号输入后立即确认会同步 DOM 光标和模型选区（只读） | Chromium / WebKit 已回归 |
| `line-numbers.spec.ts` | 编辑器块级 gutter › 状态栏块号跟随光标并可独立关闭 | Chromium / WebKit 已回归 |
| `markdown-task-roundtrip.spec.ts` | 任务列表渲染、源码编辑与反复切换不累积转义 390 | Chromium / WebKit 已回归 |
| `path-actions.spec.ts` | 手机目录操作 › 点击目录计数选中并保留抽屉，顶部复制、取消删除、删除含子目录且不误删相似前缀 | Chromium / WebKit 已回归 |
| `path-markdown-export.spec.ts` | 路径递归导出 ZIP：桌面右键 | Chromium / WebKit 已回归 |
| `path-markdown-export.spec.ts` | 路径递归导出 ZIP：手机工具栏 | Chromium / WebKit 已回归 |
| `pwa-layout.spec.ts` | PWA 窄屏应用外壳 › 手机正文左移保留四位块号与折叠热区，代码右侧有留白 | Chromium / WebKit 已回归 |
| `pwa-layout.spec.ts` | PWA 窄屏应用外壳 › 千块文档仅测量视口附近 gutter 且延迟快照仍会保存 | Chromium / WebKit 已回归 |
| `reading-state-persistence.spec.ts` | 源码模式和源码视口跨刷新恢复，显式返回渲染后不再自动打开源码 | Chromium / WebKit 已回归 |
| `session-restore.spec.ts` | 会话位置恢复与编辑器查找 › 重载后恢复文档树布局、目录视图和专注模式 | Chromium / WebKit 已回归 |
| `session-restore.spec.ts` | 会话位置恢复与编辑器查找 › 切换移动文档列表保留侧栏的目录折叠状态 | Chromium / WebKit 已回归 |
| `session-restore.spec.ts` | 会话位置恢复与编辑器查找 › 专注模式中文档查找浮层可见且在主窗口关闭时同步关闭 | Chromium / WebKit 已回归 |
| `settings-navigation.spec.ts` | 编辑器状态栏紧凑且可以关闭并持久化 | Chromium / WebKit 已回归 |
| `sidebar-colors.spec.ts` | 分栏导航和工具栏跟随主题背景，保留选中反馈 | Chromium / WebKit 已回归 |
| `style-preview.spec.ts` | 风格预览跟随深浅配色，桌面四列，旧紧凑配置仍可识别 | Chromium / WebKit 已回归 |
| `toolbar-more-overflow.spec.ts` | 更多菜单跟随实际工具溢出，不重复工具栏入口 | Chromium / WebKit 已回归 |
| `toolbar-responsive.spec.ts` | 响应式编辑器工具栏 › 默认桌面窗口和表格上下文均不产生水平滚动 | Chromium / WebKit 已回归 |
| `toolbar-responsive.spec.ts` | 响应式编辑器工具栏 › 表格支持连续选择、触屏友好的行列选择和列宽持久化 | Chromium / WebKit 已回归 |
| `ui-polish.spec.ts` | 新建表单校验路径，添加标签不提交，创建失败可重试 | Chromium / WebKit 已回归 |

另有 flaky：正文右键菜单、固定分栏/书签重载；Reading workspace WebKit 另有边缘滚动条 flaky。两项完整 E2E flaky 已纳入本批 37 项双浏览器回归；Reading workspace 的边缘滚动条已在第一批处理。未以删除用例或提高超时规避失败。
