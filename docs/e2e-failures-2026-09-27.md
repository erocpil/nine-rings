# 全量 E2E 失败清单（2026-09-27）

本清单对应 macOS ARM64、Node 22.23.3、Playwright 1.55.1 的零重试首次运行。主套件 170 个不同失败用例，另有 1 个生产 PWA 失败。
同名用例保留 describe 参数；“失败于”未列出的浏览器可能通过或跳过，不能仅凭此列判断浏览器缺陷。详细错误、截图和 trace 保存在 `.local-tools/e2e/full-20260927/`。

第 1 批定向回归已通过下列 12 项：`github-background-push` 的 2 项、`search-consistency` 的 1 项、`settings-organization` 的 5 项、`font-reading-position` 的 2 项，以及 `pwa-layout` 的“边缘手势不会抢占按钮和已选中的文本”和“左右边缘从编辑器外起划也一致”2 项。详见[修复与回归记录](e2e-repair-progress.md)。下表保留初始基线，不表示这些项目当前仍失败，也不表示已经重新运行全量。

第 2 批另有 13 项 `pwa-layout` 原失败用例通过双浏览器回归：文档树工具图标、四种手势弹层字号、抽屉操作/右侧手势、普通与专注书签数量、安全区、专注按钮尺寸、左侧手势分区、视口/减少动画，以及列表数量位置、加载失败重试、收藏持久化、浏览现场、路径筛选。左/右手势及视口用例已按当前交互契约更名；原始名称仍保留在下表。
前两批累计定向通过 25 个原失败用例，初始清单另 145 项及生产 PWA 离线失败尚未完成处理；这不是新一轮全量统计。

第 3 批另有 10 个原失败用例通过双浏览器回归：`pwa-layout` 的主编辑区恢复编辑、三项只读反馈、三项新建对话框、专注首块插入、专注标题行旋转，以及 `mobile-unified-title` 的 edit 模式。修复了 320px 专注模式标题被按钮挤为零宽的实际问题。
前三批累计定向通过 35 项，初始清单另 135 项及生产 PWA 离线失败待处理；详见[修复与回归记录](e2e-repair-progress.md)，下表仍保留初始失败名称与统计。

第 4 批另有 10 项 `pwa-layout` 原失败通过双浏览器回归：六种宽度的目录/书签定位、普通模式入口与侧栏宽度、浮层/侧栏交替、专注阅读后打开设置及侧栏关闭方式。测试已按手机锚定浮层、桌面独立固定面板与当前手势入口更新，未修改产品代码。
四批累计定向通过 45 项，初始清单另 125 项及生产 PWA 离线失败待处理。下表继续保留原始全量失败记录。

第 5 批另有 7 项手势原失败完成回归：右侧近边缘分区/无标题回退、距离方向慢划、提前方向锁定、长文原生触摸、折叠三角、引用折叠按钮、阅读侧栏连续原生触摸。Chromium 7 通过，WebKit 5 通过及 2 项原有 CDP 专项跳过；没有新增跳过。
五批累计处理 52 项（50 项双浏览器通过，2 项既有 Chromium 专项通过），初始清单另 118 项及生产 PWA 离线失败仍待处理。下表继续保留原始全量失败记录。

第 6 批另有 4 项原失败完成双浏览器回归：手机工具栏横竖屏/浮层、标签间距、桌面表格上下文无横向滚动、表格选区与列宽持久化。修复完整桌面模式不收纳溢出工具、固定控件空间不足的问题；各浏览器主套件定向 6 通过、正式构建工具栏专项 5 通过，无跳过。
六批累计处理 56 项（54 项双浏览器通过、2 项既有 Chromium 专项通过），初始清单另 114 项及生产 PWA 离线失败待处理。下表仍为原始全量失败记录。

第 7 批另有 4 项 `block-workspace` 原失败完成双浏览器回归：工具间距、横竖屏弹层、背景/行号操作、键盘压缩后的关闭。更新现有弹层留白契约及同帧几何测量，未修改产品。连同 3 项按钮对齐回归，各浏览器 7 通过；Chromium 额外稳定性重复 6 次通过。
七批累计处理 60 项（58 项双浏览器通过、2 项既有 Chromium 专项通过），初始清单另 110 项及生产 PWA 离线失败待处理；早期出现的一次夹具导航中断未再现，后续全量仍需观察。下表保留原始失败记录。

第 8 批另有 7 项书签原失败完成双浏览器回归：桌面无块号标记、4 项当前书签提示、手机轻触跳转及滑动操作。修复桌面标记水平偏移 3px，更新固定面板/紧凑列表断言及独立跳转夹具；两浏览器各 14 通过，无跳过。
八批累计处理 67 项（65 项双浏览器通过、2 项既有 Chromium 专项通过），初始清单另 103 项及生产 PWA 离线失败待处理。另观察到 Chromium 长文末段点击后立即创建书签可能落到首段，独立调查尚未完成，详见[修复记录](e2e-repair-progress.md)第 8 批；不将跳转测试通过当作该差异已修复。下表保留原始全量失败记录。

第 9 批已定位并修复第 8 批额外发现的长文书签竞态：原生触摸选区先于编辑器模型更新，书签快捷键在有效焦点条件下改用原生光标对应位置。新增鼠标、触摸、确定性延迟选区回归，连同既有书签用例，Chromium/WebKit 各 13 通过；类型检查、lint、单测通过。该额外问题已关闭，原始清单计数仍为已处理 67 项、剩余 103 项及生产 PWA 离线失败。

| 文件 | 用例及参数 | 失败于 |
| --- | --- | --- |
| [additional-interface-styles.spec.ts:10](../e2e/additional-interface-styles.spec.ts#L10) | 九环可选择、持久化、切换配色，源码行号保持等宽 | chromium |
| [block-title-paste.spec.ts:39](../e2e/block-title-paste.spec.ts#L39) | 代码简介原生粘贴保留选区，正文和引用粘贴仍正常 1280 | chromium |
| [block-title-paste.spec.ts:39](../e2e/block-title-paste.spec.ts#L39) | 代码简介原生粘贴保留选区，正文和引用粘贴仍正常 390 | chromium |
| [block-workspace.spec.ts:225](../e2e/block-workspace.spec.ts#L225) | 代码和引用折叠三角位于最右侧，所有工具间距一致 | chromium |
| [block-workspace.spec.ts:259](../e2e/block-workspace.spec.ts#L259) | 手机横竖屏块弹层不超出可视范围 | chromium, webkit |
| [block-workspace.spec.ts:491](../e2e/block-workspace.spec.ts#L491) | 触屏块工作区 / 背景和块空白不关闭，行号开关可用且入口不残留焦点 | chromium, webkit |
| [block-workspace.spec.ts:532](../e2e/block-workspace.spec.ts#L532) | 触屏块工作区 / 键盘压缩可视区域后关闭按钮仍可点击 | chromium, webkit |
| [bookmark-fold-marker.spec.ts:5](../e2e/bookmark-fold-marker.spec.ts#L5) | 书签标记不遮挡折叠三角 1280 块号=false | chromium, webkit |
| [bookmarks.spec.ts:9](../e2e/bookmarks.spec.ts#L9) | 书签当前项 1280px 只读 / 紧凑行高与当前项提示跟随光标、跳转和取消书签 | chromium, webkit |
| [bookmarks.spec.ts:9](../e2e/bookmarks.spec.ts#L9) | 书签当前项 1280px 编辑 / 紧凑行高与当前项提示跟随光标、跳转和取消书签 | chromium, webkit |
| [bookmarks.spec.ts:9](../e2e/bookmarks.spec.ts#L9) | 书签当前项 390px 只读 / 紧凑行高与当前项提示跟随光标、跳转和取消书签 | chromium, webkit |
| [bookmarks.spec.ts:9](../e2e/bookmarks.spec.ts#L9) | 书签当前项 390px 编辑 / 紧凑行高与当前项提示跟随光标、跳转和取消书签 | chromium, webkit |
| [bookmarks.spec.ts:187](../e2e/bookmarks.spec.ts#L187) | 移动端书签操作 / 轻触书签条目跳转到对应文档块 | chromium |
| [bookmarks.spec.ts:253](../e2e/bookmarks.spec.ts#L253) | 移动端书签操作 / 向左滑动书签行后显示重命名和删除操作 | chromium, webkit |
| [calm-settings-toolbar.spec.ts:5](../e2e/calm-settings-toolbar.spec.ts#L5) | calm 设置层级与工具栏格式、窄区入口 | webkit |
| [calm-settings-toolbar.spec.ts:5](../e2e/calm-settings-toolbar.spec.ts#L5) | calm-compact 设置层级与工具栏格式、窄区入口 | webkit |
| [clipboard-paste.spec.ts:207](../e2e/clipboard-paste.spec.ts#L207) | 编辑器复制粘贴 / 长 shell 参数自动换行时不会让前导空格单独占据视觉行 | webkit |
| [clipboard-paste.spec.ts:377](../e2e/clipboard-paste.spec.ts#L377) | 编辑器复制粘贴 / 全选复制多个代码块不会包含语言和复制控件文字 | chromium |
| [clipboard-paste.spec.ts:411](../e2e/clipboard-paste.spec.ts#L411) | 编辑器复制粘贴 / 折叠引用块后全选复制仍只包含引用正文 | chromium |
| [clipboard-paste.spec.ts:633](../e2e/clipboard-paste.spec.ts#L633) | 编辑器复制粘贴 / Markdown 多级混合列表按层级渲染 | chromium, webkit |
| [clipboard-paste.spec.ts:832](../e2e/clipboard-paste.spec.ts#L832) | 文档树移动 / 目录与属性面板共用移动对话框，重载后路径仍正确 | chromium, webkit |
| [desktop-navigation.spec.ts:3](../e2e/desktop-navigation.spec.ts#L3) | 阅读分栏默认半宽并记住拖动比例，三个分栏工具栏一致且不显示分栏名 | chromium, webkit |
| [desktop-navigation.spec.ts:62](../e2e/desktop-navigation.spec.ts#L62) | 桌面列表入口与全局查找在只读模式可用 | webkit |
| [desktop-navigation.spec.ts:62](../e2e/desktop-navigation.spec.ts#L62) | 桌面列表入口与全局查找在编辑模式可用 | webkit |
| [desktop-workspace-parity.spec.ts:4](../e2e/desktop-workspace-parity.spec.ts#L4) | Tauri 窗口 API 模拟：桌面分栏不随专注模式缩小，搜索固定在设置上方 | chromium, webkit |
| [desktop-workspace-parity.spec.ts:4](../e2e/desktop-workspace-parity.spec.ts#L4) | Web：桌面分栏不随专注模式缩小，搜索固定在设置上方 | chromium, webkit |
| [dialog-layout.spec.ts:10](../e2e/dialog-layout.spec.ts#L10) | 新建与快速切换截图及焦点 390px dark | chromium, webkit |
| [dialog-layout.spec.ts:10](../e2e/dialog-layout.spec.ts#L10) | 新建与快速切换截图及焦点 390px light | chromium, webkit |
| [disclosure-icons.spec.ts:56](../e2e/disclosure-icons.spec.ts#L56) | 章节目录默认小三角，正文默认箭头，可独立设置并持久保存 | chromium, webkit |
| [disclosure-icons.spec.ts:115](../e2e/disclosure-icons.spec.ts#L115) | 设置原生详情项使用统一箭头，点击与键盘仍可展开收起 | chromium, webkit |
| [doc-tree-selection-layout.spec.ts:3](../e2e/doc-tree-selection-layout.spec.ts#L3) | 文档树选中前后字重及文字尺寸不变，保留选中背景 | chromium, webkit |
| [document-filter-menus.spec.ts:34](../e2e/document-filter-menus.spec.ts#L34) | 桌面筛选 / 类型、标签、排序单次点击切换且不闪退，选择后结果正确 | webkit |
| [document-filter-menus.spec.ts:34](../e2e/document-filter-menus.spec.ts#L34) | 触屏筛选 / 类型、标签、排序单次点击切换且不闪退，选择后结果正确 | webkit |
| [document-filter-menus.spec.ts:65](../e2e/document-filter-menus.spec.ts#L65) | 桌面筛选 / 键盘选项、Esc 和 Tab 不关闭父侧栏，长标签菜单限制在可视区 | chromium, webkit |
| [document-filter-menus.spec.ts:65](../e2e/document-filter-menus.spec.ts#L65) | 触屏筛选 / 键盘选项、Esc 和 Tab 不关闭父侧栏，长标签菜单限制在可视区 | chromium, webkit |
| [document-history.spec.ts:102](../e2e/document-history.spec.ts#L102) | Mac 使用 Command+Option 方向键，保留 Option 文本移动 | chromium |
| [editable-heading-selection.spec.ts:5](../e2e/editable-heading-selection.spec.ts#L5) | 编辑模式双击各级英文标题会选中当前单词 | chromium |
| [editor-ui-boundaries.spec.ts:43](../e2e/editor-ui-boundaries.spec.ts#L43) | 手机工具栏菜单互斥、重复点击与外部关闭，标题分页保留 | chromium |
| [epub-reader.spec.ts:65](../e2e/epub-reader.spec.ts#L65) | 本地 EPUB 可导入、阅读目录章节并恢复进度 | chromium, webkit |
| [exhibition-spacing.spec.ts:4](../e2e/exhibition-spacing.spec.ts#L4) | 手机展陈底部不重复留安全区，状态栏 false | chromium |
| [filtered-search.spec.ts:3](../e2e/filtered-search.spec.ts#L3) | 全局搜索增加路径类型概念筛选后保留多词匹配，清除关键词可仅按条件查询 | chromium, webkit |
| [focus-actions-parity.spec.ts:6](../e2e/focus-actions-parity.spec.ts#L6) | 专注工具 1280 / 按钮间距、复制块与编辑工具在两端可用（批 10 已通过） | chromium, webkit |
| [focus-actions-parity.spec.ts:6](../e2e/focus-actions-parity.spec.ts#L6) | 专注工具 390 / 按钮间距、复制块与编辑工具在两端可用（批 10 已通过） | chromium, webkit |
| [focus-actions-parity.spec.ts:6](../e2e/focus-actions-parity.spec.ts#L6) | 专注工具 844 / 按钮间距、复制块与编辑工具在两端可用（批 10 已通过） | chromium, webkit |
| [focus-readonly-toggle.spec.ts:5](../e2e/focus-readonly-toggle.spec.ts#L5) | 专注标题前的线框锁切换只读，横竖屏不退出专注（批 10 已通过） | chromium, webkit |
| [fold-button-layout.spec.ts:110](../e2e/fold-button-layout.spec.ts#L110) | 标题内折叠控件不进入编辑、撤销及剪贴板数据（批 10 已通过） | chromium, webkit |
| [font-reading-position.spec.ts:91](../e2e/font-reading-position.spec.ts#L91) | mouse / 排版设置改变字体字号后顶部文字保持位置（桌面） | webkit |
| [font-reading-position.spec.ts:153](../e2e/font-reading-position.spec.ts#L153) | 桌面上方内容异步变高后保持阅读锚点，用户滚动后不拉回旧位置 | webkit |
| [github-background-push.spec.ts:24](../e2e/github-background-push.spec.ts#L24) | 关闭及重开设置页后继续上传，禁止重复 Push，完成后显示全局结果 | chromium, webkit |
| [github-background-push.spec.ts:99](../e2e/github-background-push.spec.ts#L99) | 取消上传不会写 latest，也不会显示成功或记录成功版本 | chromium, webkit |
| [heading-fold.spec.ts:41](../e2e/heading-fold.spec.ts#L41) | 标题章节可按层级折叠，并从目录统一展开 | chromium, webkit |
| [heading-fold.spec.ts:433](../e2e/heading-fold.spec.ts#L433) | 触控目录宽度调整 / 宽屏触控通过 pointer 拖动固定目录且清理选择状态 | chromium, webkit |
| [hook-lifecycle.spec.ts:43](../e2e/hook-lifecycle.spec.ts#L43) | StrictMode 连接检查更换 Token 后重新请求并丢弃旧响应 | chromium, webkit |
| [hook-lifecycle.spec.ts:108](../e2e/hook-lifecycle.spec.ts#L108) | 虚拟目录实测行高变化后更新后续行的位置 | chromium, webkit |
| [line-numbers.spec.ts:83](../e2e/line-numbers.spec.ts#L83) | 编辑器块级 gutter / 只读文档仍显示块编号，但不显示插入按钮 | chromium, webkit |
| [markdown-import.spec.ts:3](../e2e/markdown-import.spec.ts#L3) | Markdown 可按指定路径和元数据导入为文档 | chromium, webkit |
| [mermaid-code-block.spec.ts:100](../e2e/mermaid-code-block.spec.ts#L100) | Mermaid 弹层支持滚轮缩放、拖动和适应窗口 | chromium, webkit |
| [mobile-block-selection.spec.ts:22](../e2e/mobile-block-selection.spec.ts#L22) | 手机块级操作 / 独立选择、取消、格式化并通过按钮编辑，左划不再进入编辑 | chromium, webkit |
| [mobile-block-selection.spec.ts:84](../e2e/mobile-block-selection.spec.ts#L84) | 手机块级操作 / 多选不同类型块按文档顺序切换，编辑长度改变后仍只切换已选块 | chromium, webkit |
| [mobile-fold.spec.ts:59](../e2e/mobile-fold.spec.ts#L59) | 手机安装版折叠操作 / 真实触摸可切换标题、目录批量折叠和引用块（批 12 已通过） | chromium, webkit |
| [mobile-interaction-recovery.spec.ts:22](../e2e/mobile-interaction-recovery.spec.ts#L22) | 键盘打开时顶部栏随外壳定位且不盖住侧栏 | chromium, webkit |
| [mobile-interaction-recovery.spec.ts:57](../e2e/mobile-interaction-recovery.spec.ts#L57) | 专注模式开关键盘不为隐藏的顶部栏预留空间 | chromium, webkit |
| [mobile-rotation-viewport.spec.ts:5](../e2e/mobile-rotation-viewport.spec.ts#L5) | 横屏工具栏可触摸，旋转后滞留高度不会把文档树截成半屏 | chromium, webkit |
| [mobile-toolbar-fit.spec.ts:27](../e2e/mobile-toolbar-fit.spec.ts#L27) | 工具栏按宽度补回按钮，手机横屏隐藏密码入口并加宽目录 | chromium, webkit |
| [mobile-unified-title.spec.ts:43](../e2e/mobile-unified-title.spec.ts#L43) | 手机 edit：普通/专注共用一行，旋转不重复，正文滚动不遮挡标题 | chromium, webkit |
| [ordered-list-layout.spec.ts:35](../e2e/ordered-list-layout.spec.ts#L35) | 手机编号列 / 从 1 开始的列表保留句点后间距和正文悬挂缩进 | chromium |
| [ordered-list-layout.spec.ts:35](../e2e/ordered-list-layout.spec.ts#L35) | 手机编号列 / 从 998 开始的列表保留句点后间距和正文悬挂缩进 | chromium |
| [ordered-list-layout.spec.ts:35](../e2e/ordered-list-layout.spec.ts#L35) | 桌面编号列 / 从 1 开始的列表保留句点后间距和正文悬挂缩进 | chromium |
| [ordered-list-layout.spec.ts:35](../e2e/ordered-list-layout.spec.ts#L35) | 桌面编号列 / 从 998 开始的列表保留句点后间距和正文悬挂缩进 | chromium |
| [pdf-export.spec.ts:4](../e2e/pdf-export.spec.ts#L4) | PDF 打印视图用语义标题生成侧栏书签且不在正文插入目录 | webkit |
| [pdf-open-performance.spec.ts:55](../e2e/pdf-open-performance.spec.ts#L55) | PDF 批注读取失败可清理并重试 | webkit |
| [pdf-render-stability.spec.ts:4](../e2e/pdf-render-stability.spec.ts#L4) | PDF 横向翻页能够完成渲染且不会循环更新 | chromium |
| [pdf-scroll-stress.spec.ts:200](../e2e/pdf-scroll-stress.spec.ts#L200) | PDF 解析尚未完成时返回会终止加载 Worker | webkit |
| [pwa-layout.spec.ts:70](../e2e/pwa-layout.spec.ts#L70) | PWA 窄屏应用外壳 / 文档树工具图标一致且滚轮横向浏览溢出工具 | chromium, webkit |
| [pwa-layout.spec.ts:93](../e2e/pwa-layout.spec.ts#L93) | PWA 窄屏应用外壳 / 四种手势弹层主要文字统一为13px | chromium, webkit |
| [pwa-layout.spec.ts:126](../e2e/pwa-layout.spec.ts#L126) | PWA 窄屏应用外壳 / 抽屉操作等宽右对齐且右侧手势上目录下书签 | chromium, webkit |
| [pwa-layout.spec.ts:151](../e2e/pwa-layout.spec.ts#L151) | PWA 窄屏应用外壳 / 块内换行在工具栏且复制块保留引用格式 | chromium, webkit |
| [pwa-layout.spec.ts:251](../e2e/pwa-layout.spec.ts#L251) | PWA 窄屏应用外壳 / 普通模式目录书签对齐入口行且侧滑面板加宽 | chromium, webkit |
| [pwa-layout.spec.ts:276](../e2e/pwa-layout.spec.ts#L276) | PWA 窄屏应用外壳 / 普通与专注模式共享书签数量 | chromium, webkit |
| [pwa-layout.spec.ts:291](../e2e/pwa-layout.spec.ts#L291) | PWA 窄屏应用外壳 / 抽屉覆盖底部安全区且文档树加宽 | chromium, webkit |
| [pwa-layout.spec.ts:316](../e2e/pwa-layout.spec.ts#L316) | PWA 窄屏应用外壳 / 文档显示字段独立配置且排序方向保留 | chromium |
| [pwa-layout.spec.ts:367](../e2e/pwa-layout.spec.ts#L367) | PWA 窄屏应用外壳 / 切换文档视图时数量保持在筛选按钮左侧 | chromium, webkit |
| [pwa-layout.spec.ts:450](../e2e/pwa-layout.spec.ts#L450) | PWA 窄屏应用外壳 / 专注模式右侧按钮宽度间距与普通模式一致 | chromium, webkit |
| [pwa-layout.spec.ts:505](../e2e/pwa-layout.spec.ts#L505) | PWA 窄屏应用外壳 / 文档列表加载失败可重试，空结果可清除筛选 | chromium, webkit |
| [pwa-layout.spec.ts:538](../e2e/pwa-layout.spec.ts#L538) | PWA 窄屏应用外壳 / 文档收藏持久保存，路径选择可搜索并取消 | chromium, webkit |
| [pwa-layout.spec.ts:606](../e2e/pwa-layout.spec.ts#L606) | PWA 窄屏应用外壳 / 文档浏览保留现场，最近打开不修改文档 | chromium, webkit |
| [pwa-layout.spec.ts:658](../e2e/pwa-layout.spec.ts#L658) | PWA 窄屏应用外壳 / 文档列表按路径筛选且只搜索元数据 | chromium, webkit |
| [pwa-layout.spec.ts:688](../e2e/pwa-layout.spec.ts#L688) | PWA 窄屏应用外壳 / 左边缘上半部打开文档视图，下半部打开文档树 | chromium, webkit |
| [pwa-layout.spec.ts:718](../e2e/pwa-layout.spec.ts#L718) | PWA 窄屏应用外壳 / 手机顶部查找居左，目录书签专注居右 | chromium, webkit |
| [pwa-layout.spec.ts:744](../e2e/pwa-layout.spec.ts#L744) | PWA 窄屏应用外壳 / 两种文档侧栏统一顶部高度与收起样式，文档视图可进入阅读 | chromium, webkit |
| [pwa-layout.spec.ts:771](../e2e/pwa-layout.spec.ts#L771) | PWA 窄屏应用外壳 / 普通模式左划区分书签目录，设置仅在阅读侧栏提供 | chromium, webkit |
| [pwa-layout.spec.ts:789](../e2e/pwa-layout.spec.ts#L789) | PWA 窄屏应用外壳 / 文档工具栏右对齐且抽屉收起按钮使用紧凑线框图标 | chromium, webkit |
| [pwa-layout.spec.ts:834](../e2e/pwa-layout.spec.ts#L834) | PWA 窄屏应用外壳 / 使用顶部入口导航且移动编辑器保持简洁 | chromium, webkit |
| [pwa-layout.spec.ts:1016](../e2e/pwa-layout.spec.ts#L1016) | PWA 窄屏应用外壳 / 非专注模式书签与目录弹层居中且位置一致（1280px） | chromium, webkit |
| [pwa-layout.spec.ts:1016](../e2e/pwa-layout.spec.ts#L1016) | PWA 窄屏应用外壳 / 非专注模式书签与目录弹层居中且位置一致（320px） | chromium, webkit |
| [pwa-layout.spec.ts:1016](../e2e/pwa-layout.spec.ts#L1016) | PWA 窄屏应用外壳 / 非专注模式书签与目录弹层居中且位置一致（390px） | chromium, webkit |
| [pwa-layout.spec.ts:1016](../e2e/pwa-layout.spec.ts#L1016) | PWA 窄屏应用外壳 / 非专注模式书签与目录弹层居中且位置一致（600px） | chromium, webkit |
| [pwa-layout.spec.ts:1016](../e2e/pwa-layout.spec.ts#L1016) | PWA 窄屏应用外壳 / 非专注模式书签与目录弹层居中且位置一致（768px） | chromium, webkit |
| [pwa-layout.spec.ts:1016](../e2e/pwa-layout.spec.ts#L1016) | PWA 窄屏应用外壳 / 非专注模式书签与目录弹层居中且位置一致（769px） | chromium, webkit |
| [pwa-layout.spec.ts:1069](../e2e/pwa-layout.spec.ts#L1069) | PWA 窄屏应用外壳 / 点击目录书签使用浮层，右侧滑动使用侧栏，交替打开不串用 | chromium, webkit |
| [pwa-layout.spec.ts:1118](../e2e/pwa-layout.spec.ts#L1118) | PWA 窄屏应用外壳 / 专注阅读侧栏右上角设置替代关闭按钮并保留专注状态 | chromium, webkit |
| [pwa-layout.spec.ts:1137](../e2e/pwa-layout.spec.ts#L1137) | PWA 窄屏应用外壳 / 手机阅读侧栏与文档树同宽同速，支持遮罩、右划和 Escape 收起 | chromium, webkit |
| [pwa-layout.spec.ts:1202](../e2e/pwa-layout.spec.ts#L1202) | PWA 窄屏应用外壳 / 阅读侧栏连续触摸可滚动目录、右划关闭且保留书签行操作 | chromium |
| [pwa-layout.spec.ts:1251](../e2e/pwa-layout.spec.ts#L1251) | PWA 窄屏应用外壳 / 专注模式右侧近边缘左划按上下区域打开书签和目录 | chromium, webkit |
| [pwa-layout.spec.ts:1299](../e2e/pwa-layout.spec.ts#L1299) | PWA 窄屏应用外壳 / 左右边缘采用相同的距离方向判定并允许慢划 | chromium, webkit |
| [pwa-layout.spec.ts:1343](../e2e/pwa-layout.spec.ts#L1343) | PWA 窄屏应用外壳 / 边缘滑动提前锁定方向，纵向滚动和取消后不再打开面板 | chromium, webkit |
| [pwa-layout.spec.ts:1387](../e2e/pwa-layout.spec.ts#L1387) | PWA 窄屏应用外壳 / 边缘横划不会带动长文滚动，纵划仍能正常阅读 | chromium |
| [pwa-layout.spec.ts:1424](../e2e/pwa-layout.spec.ts#L1424) | PWA 窄屏应用外壳 / 折叠三角支持边缘滑动且不误折叠 | chromium, webkit |
| [pwa-layout.spec.ts:1454](../e2e/pwa-layout.spec.ts#L1454) | PWA 窄屏应用外壳 / 引用折叠按钮左划打开书签且点按仍可折叠 | chromium, webkit |
| [pwa-layout.spec.ts:1471](../e2e/pwa-layout.spec.ts#L1471) | PWA 窄屏应用外壳 / 边缘手势不会抢占按钮和已选中的文本 | chromium, webkit |
| [pwa-layout.spec.ts:1495](../e2e/pwa-layout.spec.ts#L1495) | PWA 窄屏应用外壳 / 左右边缘从编辑器外起划也一致，遮罩支持反向关闭并阻止竖向滚动 | chromium, webkit |
| [pwa-layout.spec.ts:1517](../e2e/pwa-layout.spec.ts#L1517) | PWA 窄屏应用外壳 / 左右侧栏使用同一可视视口坐标和减少动画设置 | chromium, webkit |
| [pwa-layout.spec.ts:1551](../e2e/pwa-layout.spec.ts#L1551) | PWA 窄屏应用外壳 / 移动端块编号使用紧凑且可随位数扩展的 gutter | chromium, webkit |
| [pwa-layout.spec.ts:1587](../e2e/pwa-layout.spec.ts#L1587) | PWA 窄屏应用外壳 / 手机正文左移保留四位块号与折叠热区，代码右侧有留白 | chromium, webkit |
| [pwa-layout.spec.ts:1638](../e2e/pwa-layout.spec.ts#L1638) | PWA 窄屏应用外壳 / 只读文档可从主编辑区直接恢复编辑 | chromium, webkit |
| [pwa-layout.spec.ts:1673](../e2e/pwa-layout.spec.ts#L1673) | PWA 窄屏应用外壳 / 只读切换提示固定在标题行且不遮挡操作按钮（1280px） | chromium, webkit |
| [pwa-layout.spec.ts:1673](../e2e/pwa-layout.spec.ts#L1673) | PWA 窄屏应用外壳 / 只读切换提示固定在标题行且不遮挡操作按钮（320px） | chromium, webkit |
| [pwa-layout.spec.ts:1673](../e2e/pwa-layout.spec.ts#L1673) | PWA 窄屏应用外壳 / 只读切换提示固定在标题行且不遮挡操作按钮（390px） | chromium, webkit |
| [pwa-layout.spec.ts:1743](../e2e/pwa-layout.spec.ts#L1743) | PWA 窄屏应用外壳 / 手机端可稳定点按 gutter 加号且编辑区避开 splitter 热区 | chromium, webkit |
| [pwa-layout.spec.ts:1776](../e2e/pwa-layout.spec.ts#L1776) | PWA 窄屏应用外壳 / 宽屏触控设备拖动侧栏 splitter 不会触发页面选择 | chromium, webkit |
| [pwa-layout.spec.ts:1819](../e2e/pwa-layout.spec.ts#L1819) | PWA 窄屏应用外壳 / 千块文档仅测量视口附近 gutter 且延迟快照仍会保存 | chromium, webkit |
| [pwa-layout.spec.ts:1953](../e2e/pwa-layout.spec.ts#L1953) | PWA 窄屏应用外壳 / 专注模式保留极简标题栏并可按需展开编辑工具 | chromium, webkit |
| [pwa-layout.spec.ts:2068](../e2e/pwa-layout.spec.ts#L2068) | PWA 窄屏应用外壳 / 专注模式首个 gutter 加号完整避开固定标题栏并可触摸 | chromium, webkit |
| [pwa-layout.spec.ts:2102](../e2e/pwa-layout.spec.ts#L2102) | PWA 窄屏应用外壳 / 专注模式在竖屏、横屏和桌面均隐藏原始文档标题行 | chromium, webkit |
| [pwa-layout.spec.ts:2156](../e2e/pwa-layout.spec.ts#L2156) | PWA 窄屏应用外壳 / 手机端可从更多菜单在当前块内插入 hard break | chromium, webkit |
| [pwa-layout.spec.ts:2216](../e2e/pwa-layout.spec.ts#L2216) | PWA 窄屏应用外壳 / 虚拟键盘打开时更多菜单上移以完整展示操作 | chromium |
| [pwa-layout.spec.ts:2285](../e2e/pwa-layout.spec.ts#L2285) | PWA 窄屏应用外壳 / 更多菜单在窄屏和横屏优先完整显示，极小视口仍可滚动 | chromium |
| [pwa-layout.spec.ts:2350](../e2e/pwa-layout.spec.ts#L2350) | PWA 窄屏应用外壳 / 从文档弹层发起新建时先关闭弹层并把对话框放在最上层 | chromium, webkit |
| [pwa-layout.spec.ts:2366](../e2e/pwa-layout.spec.ts#L2366) | PWA 窄屏应用外壳 / 新建文档默认布局不产生横向或纵向滚动条 | chromium, webkit |
| [pwa-layout.spec.ts:2399](../e2e/pwa-layout.spec.ts#L2399) | PWA 窄屏应用外壳 / 新建文档在虚拟键盘打开时完整停留在可视区域 | chromium, webkit |
| [pwa-layout.spec.ts:2512](../e2e/pwa-layout.spec.ts#L2512) | PWA 窄屏应用外壳 / 软键盘高度不会重复压缩覆盖层和正文滚动区 | chromium, webkit |
| [pwa-layout.spec.ts:2547](../e2e/pwa-layout.spec.ts#L2547) | PWA 窄屏应用外壳 / 搜索收起虚拟键盘后左右侧栏与遮罩恢复整屏高度 | chromium, webkit |
| [pwa-layout.spec.ts:2599](../e2e/pwa-layout.spec.ts#L2599) | PWA 窄屏应用外壳 / 键盘打开后旋转时侧栏不保留旧方向的宽高 | chromium, webkit |
| [pwa-layout.spec.ts:2657](../e2e/pwa-layout.spec.ts#L2657) | PWA 窄屏应用外壳 / 编辑状态下光标不会被底部边界遮挡 | chromium, webkit |
| [pwa-layout.spec.ts:2686](../e2e/pwa-layout.spec.ts#L2686) | PWA 窄屏应用外壳 / 横竖屏往返保持字体比例和当前光标行可见位置 | chromium, webkit |
| [pwa-offline.spec.ts:32](../e2e/pwa-offline.spec.ts#L32) | 生产 PWA 安装后可以离线冷启动并恢复本地编辑 | pwa-webkit |
| [quick-switcher.spec.ts:12](../e2e/quick-switcher.spec.ts#L12) | 快速切换支持最近访问、检索与完整键盘操作 | webkit |
| [reader-fullscreen-navigation.spec.ts:91](../e2e/reader-fullscreen-navigation.spec.ts#L91) | 桌面全屏导航 / EPUB 全屏目录书签可收起、打开时固定工具栏且不重排正文 | chromium, webkit |
| [reader-toolbar-shell.spec.ts:7](../e2e/reader-toolbar-shell.spec.ts#L7) | EPUB 阅读工具栏触屏与键盘边界（独立组件） | chromium, webkit |
| [reader-toolbar-shell.spec.ts:7](../e2e/reader-toolbar-shell.spec.ts#L7) | PDF 阅读工具栏触屏与键盘边界（独立组件） | chromium, webkit |
| [reader-toolbar.spec.ts:21](../e2e/reader-toolbar.spec.ts#L21) | EPUB 工具栏适配窄屏，设置互斥且不改变正文视口或重建内容 | chromium, webkit |
| [reader-toolbar.spec.ts:21](../e2e/reader-toolbar.spec.ts#L21) | PDF 工具栏适配窄屏，设置互斥且不改变正文视口或重建内容 | chromium, webkit |
| [reading-library.spec.ts:5](../e2e/reading-library.spec.ts#L5) | 资料库的旧设置入口和键盘返回保持笔记工作区 | chromium, webkit |
| [reading-library.spec.ts:21](../e2e/reading-library.spec.ts#L21) | 独立阅读入口保留筛选与滚动位置，摘录返回笔记 1280 | chromium, webkit |
| [reading-library.spec.ts:21](../e2e/reading-library.spec.ts#L21) | 独立阅读入口保留筛选与滚动位置，摘录返回笔记 390 | chromium, webkit |
| [reading-state-persistence.spec.ts:51](../e2e/reading-state-persistence.spec.ts#L51) | 局部只读渲染刷新后恢复折叠和块锚点 | chromium, webkit |
| [readonly-heading-fold.spec.ts:158](../e2e/readonly-heading-fold.spec.ts#L158) | 只读正文双击折叠后所属标题停留在双击位置附近 | chromium, webkit |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 1280x800 light | chromium, webkit |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 320x480 light | chromium, webkit |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 390x844 dark | chromium, webkit |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 390x844 fu | chromium, webkit |
| [recycle-bin.spec.ts:200](../e2e/recycle-bin.spec.ts#L200) | 回收站卡片与固定操作区布局 844x390 dark | chromium, webkit |
| [search-consistency.spec.ts:3](../e2e/search-consistency.spec.ts#L3) | 真实 Worker 搜索覆盖文档、多词和超过一页结果，移动删除后索引刷新 | chromium, webkit |
| [search-navigation.spec.ts:57](../e2e/search-navigation.spec.ts#L57) | 搜索定位与编辑器布局锚点 / 文档查找首次下一处从当前光标之后开始 | chromium |
| [search-scope-ui.spec.ts:4](../e2e/search-scope-ui.spec.ts#L4) | 查找范围和紧凑控件状态 1280 | chromium, webkit |
| [settings-navigation.spec.ts:164](../e2e/settings-navigation.spec.ts#L164) | 设置弹窗具有语义并在键盘关闭后恢复焦点 | chromium, webkit |
| [settings-organization.spec.ts:12](../e2e/settings-organization.spec.ts#L12) | 设置提示不改变主题和折叠选项布局 1280px | chromium, webkit |
| [settings-organization.spec.ts:12](../e2e/settings-organization.spec.ts#L12) | 设置提示不改变主题和折叠选项布局 390px | chromium, webkit |
| [settings-organization.spec.ts:72](../e2e/settings-organization.spec.ts#L72) | 排版应用失败保留草稿及原有块显示设置，重试完整保存 | chromium, webkit |
| [settings-organization.spec.ts:99](../e2e/settings-organization.spec.ts#L99) | 集中书签打开并定位只读正文 full | chromium, webkit |
| [settings-organization.spec.ts:99](../e2e/settings-organization.spec.ts#L99) | 集中书签打开并定位只读正文 virtual | chromium, webkit |
| [settings-preferences.spec.ts:4](../e2e/settings-preferences.spec.ts#L4) | 设置关键词定位与密码说明 1280 | chromium, webkit |
| [settings-preferences.spec.ts:4](../e2e/settings-preferences.spec.ts#L4) | 设置关键词定位与密码说明 390 | chromium, webkit |
| [settings-preferences.spec.ts:59](../e2e/settings-preferences.spec.ts#L59) | 列表显示偏好重启保留，关键词与筛选不落盘 | chromium, webkit |
| [settings-review.spec.ts:9](../e2e/settings-review.spec.ts#L9) | 快捷键拒绝重复和普通输入，固定窗口按键不伪装为可编辑 | chromium, webkit |
| [structured-block-exit.spec.ts:14](../e2e/structured-block-exit.spec.ts#L14) | 结构块退出行为 / 代码块行号可开启并随内容实时更新 | webkit |
| [structured-block-exit.spec.ts:157](../e2e/structured-block-exit.spec.ts#L157) | 触屏代码块退出行为 / 手机端软换行代码的行号与逻辑行首对齐且末行可见 | webkit |
| [toolbar-responsive.spec.ts:39](../e2e/toolbar-responsive.spec.ts#L39) | 响应式编辑器工具栏 / 标签输入行与编辑工具栏保持紧凑间距（批 11 已通过） | chromium, webkit |
| [toolbar-responsive.spec.ts:76](../e2e/toolbar-responsive.spec.ts#L76) | 响应式编辑器工具栏 / 默认桌面窗口和表格上下文均不产生水平滚动（批 11 已通过） | chromium, webkit |
| [toolbar-responsive.spec.ts:162](../e2e/toolbar-responsive.spec.ts#L162) | 响应式编辑器工具栏 / 表格支持连续选择、触屏友好的行列选择和列宽持久化（批 11 已通过） | chromium, webkit |
| [workspace-chrome.spec.ts:3](../e2e/workspace-chrome.spec.ts#L3) | 独立搜索不卸载正文、不退出专注模式，关闭后恢复焦点 | webkit |
