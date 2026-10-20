# 文档类型、源码权威与预览

2026-10-20。文件格式已经具有实际的视图与保存语义，不再仅是源码高亮偏好。

## 视图能力

| 类型 | 渲染 | 源码 | 并排预览 |
| --- | --- | --- | --- |
| Markdown | 普通文档渲染 | Markdown 编辑与微渲染 | 支持 |
| Flow | 整份源码的流程展示 | Markdown 形式的 Flow 源码 | 支持 |
| Mermaid | 整份源码的图表 | Mermaid 源码与基础高亮 | 支持 |
| Text、C、Python、JSON 等 | 不提供 | 纯文本或对应语言高亮 | 不提供 |

独立 Flow、Mermaid 文档无需外层代码围栏；嵌入 Markdown 时继续使用原有 Flow、Mermaid 代码块。预览是只读投影，修改正文需要回到源码；文档本身仍可设置只读，禁止源码编辑和格式更改。

并排预览沿用现有桌面布局，手机保留源码/渲染单视图切换。不可预览的类型隐藏渲染、并排预览和 Markdown 专用工具；查找替换、行号、软换行、语法折叠、撤销重做、缩进、书签和状态栏继续复用。Flow 源码可以使用 Markdown 编辑辅助；Mermaid 和普通代码不会继续 Markdown 列表，也不会响应粗斜体等 Markdown 命令。

## 数据权威

Markdown 保持现有 Delta 与渲染编辑器的权威边界，`markdownSource` 保留未经渲染编辑改写的原始 Markdown。

非 Markdown 文档以 `DocumentMetadata.sourceText` 保存原始源码；`ops` 是通过 `plainTextToDelta` 生成的可搜索纯文本投影，不经过 Markdown 解析。`sourceLanguage` 决定文档类型，`sourceFormat: text` 防止普通文本中的表格、列表等符号被历史兼容逻辑重新解释。发布元信息的 `language` 仍表示自然语言。

原有纯文本导入若没有 `sourceText`，从纯文本 ops 恢复；此前只选过语法、但尚按 Markdown 存储的文档，优先使用保留的 `markdownSource`，再使用结构化序列化结果。新导入按扩展名推断类型，并立即保留源码。编码和换行解码沿用现有文本导入约定，不新增字节级文件编码编辑能力。

源码修订使用 `SourceNavigationSession`，非 Markdown 分支构造字面段落模型，并按原始行建立导航位置；不会为了目录、书签或同步滚动再调用 Markdown 解析器。Flow、Mermaid 的预览模型单独把整份源码作为一个相应代码块投影，不替换源码权威。

## 格式切换

状态栏和 macOS“格式 → 文件格式”共用代码块语言枚举与同一条保存链路。

1. 刷新当前未保存的正文。
2. 取得当前完整源码；源码视图优先读取活动 CodeMirror 文档，渲染 Markdown 优先读取保留源码。
3. 切换到 Markdown 时解析为 Markdown Delta 并保存 `markdownSource`；切换到其它类型时保存 `sourceText` 与纯文本投影。
4. 通过现有正文保存链路提交，同时映射内部引用与书签；不能将表示方式变化冒充 metadataOnly 更新。
5. 按新类型启用或隐藏视图入口。源码中的字符、缩进、空行不会因文件格式选择而添加转义或被裁剪。

修改同一个源码视图的类型时不重建 CodeMirror，保留选区及编辑历史。Markdown 与纯文本之间解释方式不同；当切回渲染并继续编辑时，后续源码标准化仍遵循既有 Markdown 编辑规则。选择已生效的类型是空操作。

## 语法、预览与故障

CodeMirror 使用 Compartment 切换语法，按需加载 `@codemirror/language-data`；Text 不安装解析器，Flow 复用 Markdown，Mermaid 使用轻量词法高亮，真正的图表校验仍由 Mermaid 渲染器负责。异步语言请求具有失效检查，旧请求不能覆盖新选择。

独立预览复用 `FlowBlockContent` 和 `MermaidDiagram`。并排预览复用同一代码块渲染器，保证语法和主题一致。Mermaid 错误不会改写或删除原文；源码入口始终保留，用户可返回修正。编辑类插件在只读预览表面禁用，切回源码后恢复相应能力。

纯文本/代码保持源码视图，重开恢复源码滚动位置。Flow、Mermaid 可恢复上次渲染/源码选择；源码与图形不具有逐行一一对应关系，并排滚动使用现有锚点及滚动范围映射。

## 导入、导出与增量备份

文本导入白名单扩展到支持的代码及图表扩展名；仍先解码文本、拒绝二进制控制字符。单文档导出使用对应扩展名，原始源码不添加 Markdown 标题、不裁剪尾部空白。

增量元数据认证允许 `sourceText`，并核对其纯文本投影与正文一致。Flow、Mermaid 派生资源复用现有可移植资源检查；源码中包含不能备份的本机图片引用时不能绕过认证。源码字符串作为文字保存，不被当成 HTML 插入页面。

## 验证

单测覆盖类型能力矩阵、菜单枚举、扩展名推断、原始源码往返、纯文本导航及备份认证。Chromium/WebKit 交互回归覆盖源码专用入口、Markdown 命令门禁、空行和缩进、撤销/重做、Text/Markdown 往返、Flow/Mermaid 三种视图、连续重开和 Mermaid 错误恢复。macOS 原生菜单的实际展示需要重新构建 Tauri 后确认，浏览器测试使用同一宿主命令注册器。
