# Markdown 兼容范围与内容契约

2026-10-10 起，Web、PWA、Tauri 桌面和 Python 批量导入使用同一套 CommonMark/GFM 解析及结构化导出。基础语法以 [GFM](https://github.github.com/gfm/) 为准；GitHub 网站额外支持的脚注、公式、Mermaid 和提示引用另行支持。原始 [Markdown 语法](https://daringfireball.net/projects/markdown/syntax) 是历史基础，不包含 GFM 的完整扩展和明确的边界规则。

这是一份兼容范围声明，不是 GitHub 网站功能或任意 HTML 的完整复制。

## 标准语法

- ATX/Setext 标题、关闭标记、分隔线、缩进代码、反引号/波浪线围栏和代码 info。
- 软换行、两个空格或反斜线构成的硬换行；星号/下划线强调、删除线、代码 span、实体与转义。
- 无序/有序/任务列表、嵌套、续段、空项和列表内引用/代码等结构。
- 可选外侧竖线的表格、列数校验、对齐和转义竖线；单元格换行导出为 `<br>`。
- 内联/引用式链接、自动链接、title、平衡括号；行内图片保留位置、alt/title 和链接，独立图片继续使用可缩放块。
- 文档内标题链接包含嵌套标题；受限 HTML 自定义锚点也可跳转。

列表归属按 GFM 的标记宽度和内容列判断，不能仅凭相邻空行推断。例如 `  1. 子项` 的正文列在第五列，子列表需要至少五个前导空格。无缩进的代码/引用即使紧邻列表也属于顶层。已有文档的手动块缩进与阅读折叠仍由 Delta 保留。

## GitHub 补充与项目扩展

脚注支持 Unicode/命名标签、多段正文、首次引用顺序编号和每次引用单独回跳；编辑后重算编号和回跳数量。渲染时显示在文末并提供分隔线。原始 Markdown 定义位置由源码缓存保留，渲染编辑后结构化导出仍将定义放到末尾。刻意转义的 `\[^id]` 为普通文本；无定义的单独 `[^id]` 为满足分段粘贴仍保留引用，这是项目扩展。

公式支持 `$…$`、GitHub 的美元加反引号写法、`$$` 块和 `math` 围栏。使用本地 KaTeX，宏覆盖范围与 GitHub MathJax 不保证完全一致。`\(…\)` 仍为 Nine Rings 扩展。

受限 HTML 支持 `mark`、`details/summary`、`br`、`sub/sup/ins`、基本强调、链接/图片及命名锚点；去除事件、任意样式等属性。HTML comment 不显示但保留源信息。其他 HTML 保留为不可执行的文本块/片段，不承诺与 GitHub 的 HTML 清洗后呈现相同。details 的 summary 仍是纯文本属性。

提示引用支持 `[!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]`。Mermaid 使用本地版本。`flow`、`toc`、`[[文档]]`、空 `/todo`、块模式和手动排版属于项目功能；GitHub mention、issue/PR、emoji shortcode 等网站服务不在范围内。

## 数据与实现

`gfm-parser.ts` 使用 micromark/mdast 的标准 AST，适配到既有 Delta；常见列表保留旧换行结构，复杂列表使用带版本的嵌入对象。`delta-converter.ts` 在编辑器、只读与源码预览之间保存结构。`markdown-serializer.ts` 构造 MDAST 并调用标准序列化器，避免各平台各写一套正则。

导入保存 `metadata.markdownSource` 和 `originalFileName`。没有渲染编辑时切换源码使用原文；渲染编辑后规范化导出保证支持范围内的语义，允许标记、空行、对齐空格和脚注定义位置变化。原文、语义与编辑器 UI 属性是不同契约，Markdown 不保存所有字体/颜色/折叠/缩进属性，JSON 备份保存完整 Delta。

Tauri 存储适配器与 Web 共用 `noteToMarkdown`，移除旧 Rust Markdown 命令及重复序列化器；Rust JSON 备份不变。Python CLI 通过仓库内 Node/tsx 桥接同一导入函数，不安装 Python Markdown 依赖，批量文件只启动一次转换进程。

大内容的解析、模型转换和导出继续通过同源 module Worker。实体解码显式选择不依赖 DOM 的实现，避免 Worker 中 `document is not defined`。大段粘贴的语法初筛不完整解析原文两次。标准内核与 HTML 解析依赖拆为独立 chunk；不调高警告阈值。

Flutter 的旧 Dart/Quill 导入导出尚未迁移到此内核；本轮不安装或构建 Flutter，不应把 React/Tauri 的验证结论扩展到 Flutter。

## 验证

`tests/fixtures/gfm-official.json` 固定官方 702 个示例，来源及许可在相邻 LICENSE 中。所有示例验证编辑器 schema、保存模型和再次导出可加载；非任意 HTML 的标准案例额外比较结构/格式语义，允许等价文本节点合并和不可见分隔注释。它不是 GitHub 线上逐图比对。

定向单元测试覆盖内容/目标保持、任务、多段/重复脚注、safe HTML、数学及编辑后的重新编号。`e2e/gfm-compatibility.spec.ts` 在编辑、完整只读、虚拟只读和源码预览中检查实际 DOM 与双向脚注跳转；原有导入、粘贴、源码定位、任务、目录和折叠用例继续回归。

历史问题与选型依据保留在 [2026-10-09 核查快照](markdown-gfm-audit.md)。

## 内置演示

首次安装或升级时，在 ideas 添加「Markdown 全景：GFM、GitHub 与 Nine Rings」。源文在 `src/lib/markdown-demo.md`，覆盖上述全部语法类别，包括实际图表、流程块、目录、公式、脚注、列表、表格、链接与受限 HTML；GitHub 网站专属功能和不支持的图型另提供代码示例，不伪装为本地实现。该示例与普通文档拥有相同编辑、只读、导出等能力。

种子创建复用 Markdown 导入，保存原文件名与原始源码，便于用户比较写法和效果。一次创建后不覆盖修改，不恢复用户已经删除、移动或改名的示例；已有同名 ideas 文档仅记录种子标记，不修改正文。
