# 原失败项复核（2026-09-27）

对应提交 `c8266d2`，macOS ARM64，仓库隔离工具链，串行、零重试。按原始 170 个失败用例的文件、describe 参数和名称逐项匹配当前测试，18 项已更名，合计 340 个浏览器用例。仅复核旧失败项，不代表当前 816 项主套件全量通过。

历史批次手工累加存在重复，后续以本报告的逐项结果为准。生产 PWA WebKit 离线冷启动和 Linux/Windows 原生验证仍单独跟踪。

| 浏览器 | 通过 | 失败/未完成 | 跳过 |
| --- | ---: | ---: | ---: |
| chromium | 120 | 50 | 0 |
| webkit | 115 | 50 | 5 |

双浏览器均通过 109 项；含跳过 5 项；仍有失败或未完成 56 个不同用例。跳过不计为通过。

## 后续定向修复

第 61 批关闭以下两项，`heading-fold.spec.ts` 整文件 Chromium / WebKit 各 10/10 通过（零重试），证据见 `.local-tools/e2e/repair-batch61/`：

- 标题章节可按层级折叠，并从目录统一展开。
- 触控目录宽度调整 / 宽屏触控通过 pointer 拖动固定目录且清理选择状态。

第 62 批关闭“编辑模式双击各级英文标题会选中当前单词”：修复 WebKit 多选前一块边界，双浏览器相关整组各 9/9 通过，补充替换断言后 WebKit 选词连续 3/3 通过。证据见 `.local-tools/e2e/repair-batch62/`。

第 63 批关闭 hook-lifecycle 的 Token 请求失效、目录行高两项及 reader-toolbar-shell 的 PDF / EPUB 两项，整组双浏览器各 5/5 通过，额外目录面板 WebKit 2/2 通过。

第 65 批关闭 filtered-search 多条件查询、search-navigation 首次查找起点、search-scope-ui 桌面搜索范围三项，整组双浏览器各 15/15 通过。

第 66 批关闭 settings-preferences 三项与 settings-review 快捷键一项，整组双浏览器各 10/10 通过。

第 67 批关闭 recycle-bin 的五种尺寸/主题布局用例，整文件双浏览器各 10/10 通过。

第 68 批关闭 EPUB 阅读器及全屏导航两项，双浏览器相关用例各 7/7 通过。

第 69 批关闭 PDF 批注失败重试、翻页渲染稳定性、加载中关闭并终止 Worker 三项，三份相关测试文件在 Chromium / WebKit 各 9/9 通过。

第 70 批关闭 mobile-interaction-recovery 的两项键盘布局，以及 mobile-rotation-viewport 的横屏触控/视口用例；两个文件在 Chromium / WebKit 各 3/3 通过。

第 71 批复核 `mobile-toolbar-fit` 与 `mobile-unified-title`，含三个标题布局模式的整文件回归在 Chromium / WebKit 各 6/6 通过，关闭原失败快照中的两项。

第 72 批复核有序列表布局，桌面/手机起点和编号间距设置等整文件用例在 Chromium / WebKit 各 10/10 通过，关闭原失败快照中的四项。

原始 56 项中目前剩余 **13 项**。第 73 批将移动 PWA 导航、剪贴板、工具栏/键盘及部分 gutter/splitter 用例更新到当前界面，并修复完整结构块复制被扁平化的问题；Chromium / WebKit 导航与剪贴板组各 6/6 通过，另有 Chromium gutter/splitter 4/4、工具栏/键盘 4/4、千块文档 1/1 通过。已双浏览器复核关闭 7 项。第 75 批关闭虚拟只读阅读锚点恢复用例，检查内容块与块内偏移而非跨浏览器不稳定的绝对 scrollTop。第 76 批复核通过 EPUB 全屏目录/书签在手机与桌面的行为，关闭 1 项；第 78 批的 EPUB 导入与进度恢复用例在 Chromium、WebKit 均通过，再关闭 1 项。以下表格保留第 60 批复核快照，后续关闭项见各批次记录。

## 第 60 批失败快照

| 文件 | 用例（含 describe 参数） | Chromium | WebKit |
| --- | --- | --- | --- |
| [clipboard-paste.spec.ts:873](../e2e/clipboard-paste.spec.ts#L873) | 文档树移动 / 目录与属性面板共用移动对话框，重载后路径仍正确 | passed | failed |
| [editable-heading-selection.spec.ts:5](../e2e/editable-heading-selection.spec.ts#L5) | 编辑模式双击各级英文标题会选中当前单词 | failed | passed |
| [epub-reader.spec.ts:65](../e2e/epub-reader.spec.ts#L65) | 本地 EPUB 可导入、阅读目录章节并恢复进度 | failed | failed |
| [filtered-search.spec.ts:3](../e2e/filtered-search.spec.ts#L3) | 全局搜索增加路径类型概念筛选后保留多词匹配，清除关键词可仅按条件查询 | failed | failed |
| [heading-fold.spec.ts:41](../e2e/heading-fold.spec.ts#L41) | 标题章节可按层级折叠，并从目录统一展开 | failed | failed |
| [heading-fold.spec.ts:433](../e2e/heading-fold.spec.ts#L433) | 触控目录宽度调整 / 宽屏触控通过 pointer 拖动固定目录且清理选择状态 | failed | failed |
| [hook-lifecycle.spec.ts:43](../e2e/hook-lifecycle.spec.ts#L43) | StrictMode 连接检查更换 Token 后重新请求并丢弃旧响应 | timedOut | timedOut |
| [hook-lifecycle.spec.ts:108](../e2e/hook-lifecycle.spec.ts#L108) | 虚拟目录实测行高变化后更新后续行的位置 | failed | failed |
| [mobile-interaction-recovery.spec.ts:57](../e2e/mobile-interaction-recovery.spec.ts#L57) | 专注模式开关键盘不为隐藏的顶部栏预留空间 | failed | failed |
| [mobile-interaction-recovery.spec.ts:22](../e2e/mobile-interaction-recovery.spec.ts#L22) | 键盘打开时顶部栏随外壳定位且不盖住侧栏 | failed | failed |
| [mobile-rotation-viewport.spec.ts:5](../e2e/mobile-rotation-viewport.spec.ts#L5) | 横屏工具栏可触摸，旋转后滞留高度不会把文档树截成半屏 | failed | failed |
| [pdf-open-performance.spec.ts:55](../e2e/pdf-open-performance.spec.ts#L55) | PDF 批注读取失败可清理并重试 | timedOut | passed |
| [pdf-render-stability.spec.ts:4](../e2e/pdf-render-stability.spec.ts#L4) | PDF 横向翻页能够完成渲染且不会循环更新 | failed | passed |
| [pdf-scroll-stress.spec.ts:200](../e2e/pdf-scroll-stress.spec.ts#L200) | PDF 解析尚未完成时返回会终止加载 Worker | failed | failed |
| [pwa-layout.spec.ts:1987](../e2e/pwa-layout.spec.ts#L1987) | PWA 窄屏应用外壳 / 专注模式保留极简标题栏并可按需展开编辑工具 | failed | failed |
| [pwa-layout.spec.ts:762](../e2e/pwa-layout.spec.ts#L762) | PWA 窄屏应用外壳 / 两种文档侧栏统一顶部高度与收起样式，文档视图可进入阅读 | failed | failed |
| [pwa-layout.spec.ts:852](../e2e/pwa-layout.spec.ts#L852) | PWA 窄屏应用外壳 / 使用顶部入口导航且移动编辑器保持简洁 | timedOut | timedOut |
| [pwa-layout.spec.ts:1853](../e2e/pwa-layout.spec.ts#L1853) | PWA 窄屏应用外壳 / 千块文档仅测量视口附近 gutter 且延迟快照仍会保存 | timedOut | failed |
| [pwa-layout.spec.ts:1683](../e2e/pwa-layout.spec.ts#L1683) | PWA 窄屏应用外壳 / 只读文档可从主编辑区直接恢复编辑 | passed | timedOut |
| [pwa-layout.spec.ts:161](../e2e/pwa-layout.spec.ts#L161) | PWA 窄屏应用外壳 / 块内换行在工具栏且复制块保留引用格式 | failed | failed |
| [pwa-layout.spec.ts:1810](../e2e/pwa-layout.spec.ts#L1810) | PWA 窄屏应用外壳 / 宽屏触控设备拖动侧栏 splitter 不会触发页面选择 | failed | failed |
| [pwa-layout.spec.ts:1632](../e2e/pwa-layout.spec.ts#L1632) | PWA 窄屏应用外壳 / 手机正文左移保留四位块号与折叠热区，代码右侧有留白 | timedOut | timedOut |
| [pwa-layout.spec.ts:2192](../e2e/pwa-layout.spec.ts#L2192) | PWA 窄屏应用外壳 / 手机端可从更多菜单在当前块内插入 hard break | failed | failed |
| [pwa-layout.spec.ts:1777](../e2e/pwa-layout.spec.ts#L1777) | PWA 窄屏应用外壳 / 手机端可稳定点按 gutter 加号且编辑区避开 splitter 热区 | failed | failed |
| [pwa-layout.spec.ts:736](../e2e/pwa-layout.spec.ts#L736) | PWA 窄屏应用外壳 / 手机顶部查找居左，目录书签专注居右 | timedOut | timedOut |
| [pwa-layout.spec.ts:2586](../e2e/pwa-layout.spec.ts#L2586) | PWA 窄屏应用外壳 / 搜索收起虚拟键盘后左右侧栏与遮罩恢复整屏高度 | timedOut | timedOut |
| [pwa-layout.spec.ts:807](../e2e/pwa-layout.spec.ts#L807) | PWA 窄屏应用外壳 / 文档工具栏右对齐且抽屉收起按钮使用紧凑线框图标 | timedOut | timedOut |
| [pwa-layout.spec.ts:789](../e2e/pwa-layout.spec.ts#L789) | PWA 窄屏应用外壳 / 普通模式左划区分书签目录，设置仅在阅读侧栏提供 | failed | failed |
| [pwa-layout.spec.ts:2725](../e2e/pwa-layout.spec.ts#L2725) | PWA 窄屏应用外壳 / 横竖屏往返保持字体比例和当前光标行可见位置 | failed | failed |
| [pwa-layout.spec.ts:1596](../e2e/pwa-layout.spec.ts#L1596) | PWA 窄屏应用外壳 / 移动端块编号使用紧凑且可随位数扩展的 gutter | timedOut | timedOut |
| [pwa-layout.spec.ts:2696](../e2e/pwa-layout.spec.ts#L2696) | PWA 窄屏应用外壳 / 编辑状态下光标不会被底部边界遮挡 | timedOut | timedOut |
| [pwa-layout.spec.ts:2252](../e2e/pwa-layout.spec.ts#L2252) | PWA 窄屏应用外壳 / 虚拟键盘打开时更多菜单上移以完整展示操作 | failed | passed |
| [pwa-layout.spec.ts:2551](../e2e/pwa-layout.spec.ts#L2551) | PWA 窄屏应用外壳 / 软键盘高度不会重复压缩覆盖层和正文滚动区 | timedOut | timedOut |
| [pwa-layout.spec.ts:2638](../e2e/pwa-layout.spec.ts#L2638) | PWA 窄屏应用外壳 / 键盘打开后旋转时侧栏不保留旧方向的宽高 | timedOut | timedOut |
| [reader-fullscreen-navigation.spec.ts:91](../e2e/reader-fullscreen-navigation.spec.ts#L91) | 桌面全屏导航 / EPUB 全屏目录书签可收起、打开时固定工具栏且不重排正文 | failed | failed |
| [reader-toolbar-shell.spec.ts:7](../e2e/reader-toolbar-shell.spec.ts#L7) | EPUB 阅读工具栏触屏与键盘边界（独立组件） | failed | failed |
| [reader-toolbar-shell.spec.ts:7](../e2e/reader-toolbar-shell.spec.ts#L7) | PDF 阅读工具栏触屏与键盘边界（独立组件） | failed | failed |
| [reader-toolbar.spec.ts:24](../e2e/reader-toolbar.spec.ts#L24) | PDF 工具栏适配窄屏，设置互斥且不改变正文视口或重建内容 | failed | passed |
| [reading-library.spec.ts:21](../e2e/reading-library.spec.ts#L21) | 独立阅读入口保留筛选与滚动位置，摘录返回笔记 1280 | timedOut | timedOut |
| [reading-library.spec.ts:21](../e2e/reading-library.spec.ts#L21) | 独立阅读入口保留筛选与滚动位置，摘录返回笔记 390 | timedOut | timedOut |
| [reading-library.spec.ts:5](../e2e/reading-library.spec.ts#L5) | 资料库的旧设置入口和键盘返回保持笔记工作区 | failed | failed |
| [reading-state-persistence.spec.ts:51](../e2e/reading-state-persistence.spec.ts#L51) | 局部只读渲染刷新后恢复折叠和块锚点 | passed | failed |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 1280x800 light | failed | failed |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 320x480 light | failed | failed |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 390x844 dark | failed | failed |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 390x844 fu | failed | failed |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 844x390 dark | failed | failed |
| [search-navigation.spec.ts:57](../e2e/search-navigation.spec.ts#L57) | 搜索定位与编辑器布局锚点 / 文档查找首次下一处从当前光标之后开始 | failed | passed |
| [search-scope-ui.spec.ts:4](../e2e/search-scope-ui.spec.ts#L4) | 查找范围和紧凑控件状态 1280 | timedOut | timedOut |
| [settings-preferences.spec.ts:59](../e2e/settings-preferences.spec.ts#L59) | 列表显示偏好重启保留，关键词与筛选不落盘 | timedOut | timedOut |
| [settings-preferences.spec.ts:4](../e2e/settings-preferences.spec.ts#L4) | 设置关键词定位与密码说明 1280 | failed | failed |
| [settings-preferences.spec.ts:4](../e2e/settings-preferences.spec.ts#L4) | 设置关键词定位与密码说明 390 | failed | failed |
| [settings-review.spec.ts:9](../e2e/settings-review.spec.ts#L9) | 快捷键拒绝重复和普通输入，固定窗口按键不伪装为可编辑 | failed | failed |
| [structured-block-exit.spec.ts:14](../e2e/structured-block-exit.spec.ts#L14) | 结构块退出行为 / 代码块行号可开启并随内容实时更新 | passed | failed |
| [structured-block-exit.spec.ts:157](../e2e/structured-block-exit.spec.ts#L157) | 触屏代码块退出行为 / 手机端软换行代码的行号与逻辑行首对齐且末行可见 | passed | failed |
| [workspace-chrome.spec.ts:3](../e2e/workspace-chrome.spec.ts#L3) | 独立搜索不卸载正文、不退出专注模式，关闭后恢复焦点 | passed | failed |

## 跳过项

- `clipboard-paste.spec.ts` / 全选复制多个代码块不会包含语言和复制控件文字 — webkit：原生系统剪贴板自动化需要 Chromium 的 clipboard-read/write 权限；粘贴事件和解析另行跨浏览器验证
- `clipboard-paste.spec.ts` / 折叠引用块后全选复制仍只包含引用正文 — webkit：原生系统剪贴板自动化需要 Chromium 的 clipboard-read/write 权限；粘贴事件和解析另行跨浏览器验证
- `pdf-export.spec.ts` / PDF 打印视图用语义标题生成侧栏书签且不在正文插入目录 — webkit：Playwright 的 page.pdf 仅支持 Chromium；打印视图结构已跨浏览器验证
- `pwa-layout.spec.ts` / 边缘横划不会带动长文滚动，纵划仍能正常阅读 — webkit：真实触摸轨迹使用 Chromium CDP；WebKit 在事件回归中验证取消默认滚动
- `pwa-layout.spec.ts` / 阅读侧栏连续触摸可滚动目录、右划关闭且保留书签行操作 — webkit：连续原生触摸轨迹使用 CDP，WebKit 验证事件和布局回归

## 验证证据

`.local-tools/e2e/recheck-20260927/` 保存 `cases.json`（旧名到当前名称映射）、`recheck.config.ts`、`run.log`、`results.json`、`case-results.json` 与 `counts.json`。首次启动因临时配置未指定服务 cwd 而无效，已中止，日志单独保留为 `invalid-server-cwd.*`，未计入上述结果。
