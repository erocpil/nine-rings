# PDF 阅读能力：定位、边界与 MVP

## 1. 产品定位

Nine Rings 支持 PDF 的目的不是替代系统预览、Adobe Acrobat 等通用工具，而是补齐“外部资料 → 阅读 → 定位 → 摘录到知识库”的工作流。

仅能打开 PDF 的收益有限；真正有价值的方向是：

- 可靠地恢复阅读页码和缩放比例。
- 使用 PDF 自带目录和文本搜索定位内容。
- 后续把选中文本摘录到 Nine Rings 笔记，并保存 PDF、页码和原文之间的可返回引用。
- 保持 PDF 阅读与富文本编辑解耦，避免大文件拖慢普通文档启动和滚动。

## 2. MVP 范围

第一版实现：

- 从“设置 → 数据与导入”导入本地 `.pdf` 文件。
- PDF 作为独立本地资料保存，关闭应用后仍可再次打开。
- 使用全新的独立阅读界面，不经过 Tiptap、Delta 或笔记正文。
- 提供翻页、页码跳转、缩放、适合宽度、全屏阅读、PDF 书签/页面目录和全文搜索。
- 手机端在页面左右边界滑动换页，支持双指连续缩放；双击页面可围绕触点放大并再次双击恢复适宽。
- 全屏时页面居中，点击页面显示或主动隐藏悬浮翻页控制条，显示后 1 秒自动隐藏。
- 渲染独立的可选择文本层，可使用系统选择菜单复制 PDF 原文；扫描件仍需后续 OCR。
- 选中文本可直接生成 Reference 笔记；笔记保留 PDF、页码和原文来源，并可一键返回原页。
- 自动保存最后页码、缩放比例和最近打开时间。
- 只渲染当前页面，取消过期渲染，并在空闲片段预热下一页，控制移动端内存与 CPU 使用的同时减少连续翻页等待。
- 支持 `⌘/Ctrl+F` 搜索、方向键与 Page Up/Down 翻页、Home/End 首尾页、`+/-/0` 缩放与适宽。
- 支持删除本地 PDF。

第一版明确不实现：

- PDF 内容转为 Nine Rings 文档。
- 高亮、手写批注、表单填写或修改 PDF 文件。
- OCR 和扫描件文字识别。
- PDF 文件的 GitHub 同步或 JSON 备份。
- 远程 URL、私有仓库和跨设备附件同步。

## 3. 数据与架构边界

PDF 使用独立的 `nine_rings_pdf_library` IndexedDB：

- Blob 与文件元数据保存在独立 object store。
- 阅读进度与 PDF 一起保存。
- 不修改现有 Note、Delta、SQLite 和 StorageAdapter 契约。
- 不把二进制转成 base64 塞入现有 JSON 备份，避免备份体积和峰值内存失控。
- Web/PWA 与 Tauri WebView 复用同一接口；后续桌面端可以把 Blob 实现替换成应用数据目录文件，而不改变阅读器组件。

PDF.js 只随阅读器动态加载。普通笔记首屏不会下载或解析 PDF.js；阅读器每次只持有当前页 Canvas。文本搜索按页提取并缓存纯文本，不预先建立整本 PDF 的同步索引。

## 4. 风险与约束

- 浏览器存储默认可能受配额和回收策略影响；导入前需要检查可用空间，并提示 PDF 不在当前备份中。
- 本地 PDF 必须读取完整 Blob；特别大的文件仍可能受 iOS WebKit 内存上限影响。
- PDF 自带目录可能缺失，扫描件也可能没有可搜索文字。
- 加密 PDF 需要密码交互；异常、损坏或不受支持的文件必须给出明确错误。
- 远程 PDF 会受到 CORS、鉴权和 Range Request 支持差异影响，因此不进入本地 MVP。

## 5. 同类产品对比与取舍

- [Zotero PDF Reader](https://www.zotero.org/support/pdf_reader) 的优势是把 PDF 标注加入笔记，并能从笔记返回原页。Nine Rings 第一阶段复用“Reference 文档”实现同样关键的可追溯阅读闭环，不把完整标注系统耦合进文本编辑器。
- [Zotero 的标注存储说明](https://www.zotero.org/support/kb/annotations_in_database) 强调结构化存储对同步和性能的价值。Nine Rings 因此只在笔记元数据保存轻量来源，PDF Blob 继续使用独立 IndexedDB。
- [Adobe Acrobat 移动端导航](https://www.adobe.com/devnet-docs/acrobat/android/en/navigatesearch.html) 重点覆盖全文搜索、书签、页面导航和适合内容区域。Nine Rings 已覆盖对应的本地阅读能力，并针对手机补充边界滑动、双击边界缩放和双指缩放。

产品取舍是优先服务“资料进入知识库”，不追求替代 Acrobat 的编辑、签名和表单能力，也暂不复制 Zotero 的完整批注管理系统。

## 6. 后续阶段

“摘录到笔记”与返回 PDF 原页的闭环已经完成：选择 PDF 文本后生成 Reference 文档，并保存 `{pdfId, pdfName, page, selectedText}` 来源元数据。下一步再评估坐标级高亮、双向链接、附件备份和桌面文件系统原生存储。

OCR、批注同步和 PDF 编辑属于独立的大型能力，应在本地阅读与引用工作流验证后再决定。
