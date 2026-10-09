# Markdown / GitHub 兼容性核查（2026-10-09）

本节以下内容是修复前的历史快照。2026-10-10 已采用标准内核并统一活跃平台的导入/导出，当前范围与实现见 [Markdown 兼容范围与内容契约](markdown-compatibility.md)。

核查当时 Nine Rings 不是完整 GFM 实现。常见标题、星号强调、围栏代码、简单列表/引用、任务列表和带外侧竖线的多列表格可用，但解析边界、复合容器及导出往返存在实质差异。不能以“能够导入”或现有功能回归通过推导为 GitHub 兼容。

本次是检查与记录，不修改解析/序列化行为；此前自动目录、排版、设置及浮层功能的未提交改动保留。

## 基准与检查方法

- [GFM 0.29-gfm 规范](https://github.github.com/gfm/)是语法基准；它包括 CommonMark 和表格、任务列表、删除线、扩展自动链接、HTML 标签过滤。
- [GitHub 基础格式文档](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)、[数学公式](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)、[折叠区块](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)和[图表](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams)用于检查 GitHub 网站的额外功能。GitHub issue/comment 的换行行为与 `.md` 文件不同；这里以 `.md` 为准。
- 下载官方 `github/cmark-gfm` 的 `test/spec.txt`（672 例）和 `test/extensions.txt`（30 例），共 **702 例**。逐例运行 `mdToDelta → deltaToProseMirror`，再执行 `proseMirrorToDelta → deltaToMarkdown → mdToDelta → deltaToProseMirror`。全部完成，无解析异常。
- 将模型转换为无 UI 的语义 HTML，与示例期望结构归一化比较；另执行 **46 个定向探针**并人工检查关键差异。结构比较忽略部分容器包装、空段落、空白及默认左对齐，未实现完整 HTML5 树构造，不能把匹配数量当成 GFM 合格率，也不能据此证明列表 tight/loose 等表现一致。
- 归一化比较标出 **29 个编辑往返变化候选**，主要涉及列表续行的空格、强调/链接嵌套、代码边界和表格转义。此数为筛查结果，不等于 29 个独立产品缺陷。
- Chromium/WebKit 四种视图（编辑、完整只读、局部只读、源码预览）采集实际 DOM。下划线强调未生成标记、无外侧竖线表格未生成表格、引用式链接未解析、重复脚注引用 ID 的差异在四种视图均存在。浏览器诊断完成只证明现状被观测，不表示这些功能符合 GFM。

原始案例、脚本、模型、序列化结果、DOM 和日志在忽略目录 `.local-tools/workspace-summary/gfm-*`。规范快照 SHA-256：

- `spec.txt`：`7d8e5814befec287ac116786d81ff14e0adc9b13295b4494649e995408fd871c`
- `extensions.txt`：`a2a45e98be9fca95f564f927265a0f63beea6cae5369d1cf4bde44caa51b2a3a`

## 实际解析链路

Web/PWA/Tauri 的正文由同一 TypeScript 自写解析器处理，没有使用 CommonMark/GFM 的完整 token/AST 解析器。导入、源码及其预览、Markdown 粘贴、模板和 flow 正文均调用 `src/lib/md-parser.ts`；Worker 只是把同一实现移到后台。

导入会在 `content.metadata.markdownSource` 保留原文。未经渲染编辑时切换源码可使用原文；渲染编辑后 `MarkdownDocumentView` 会失效该原文缓存并使用规范化序列化。**因此，保留源码不代表渲染理解正确，也不保证渲染编辑后原语义仍可恢复。** 源码修改同样重新解析为 Delta，但会保留修改后的源码。

实际编辑器和只读渲染还有自己的行为：TipTap Link 插件可能在输入/交易中自动识别 URL，而无编辑器插件的只读/源码预览并不会补出该标记。这是输入路径的额外行为，不能替代导入解析器的自动链接支持。

## 核查结果

| 范围 | 当前行为与 GitHub 的关系 | 影响 / 定向复现 |
| --- | --- | --- |
| ATX H1–H6 | 普通 `## Title` 支持；空标题不支持，尾部关闭 `#` 未移除，四空格前缀被 trim 后仍当标题 | `##` 成普通文本；`## Title ##` 把末尾 `##` 纳入标题 |
| Setext 标题 | 不支持 | `Title` 后接 `=====` 成段落；接 `---` 可能拆成段落和分隔线 |
| 分隔线 | 连续 `---` 等支持；有空格的标记和同字符规则不完整 | `* * *` 成列表；`-_*` 错认成分隔线 |
| 缩进代码 | 不支持 GFM 的四空格代码规则 | `    const x = 1;` 成正文，缩进丢失 |
| 围栏代码 | 常见反引号/波浪线、较长闭合围栏支持；开围栏缩进、反引号 info string 及未闭合空块不完全一致 | 任意缩进 trim、块内容未按开围栏缩进解除，边界案例误识别 |
| 普通软换行 | 普通段落通常合并为空格，与 `.md` 显示大体相符；代码空白等不可一概 trim | 跨行代码 span 的空白被压缩 |
| 硬换行 | 行尾两个空格或反斜线未正确解析 | `first  \nsecond` 成 `first second`；反斜线保留成正文 |
| 粗体/斜体 | 星号常见写法支持；下划线及 delimiter 的完整规则不支持 | `_italic_`、`__bold__` 留作文本，随后导出转义；`** bold **` 误识别 |
| 整行粗体标签 | 项目特有行为，自动独立成段 | `**Label**` 紧接下一行正文，GitHub 是同一段落 |
| 行内代码 | 单/多反引号常用形式支持；多行、边缘空格规范化不完整 | ```` ``\nfoo \n`` ```` 尾部空格丢失 |
| 实体 | 不解码 HTML 命名/数字字符引用 | `&amp;`、`&#65;` 等显示源字符串 |
| 删除线 | `~~text~~` 支持；GitHub 当前文档列出的 `~text~` 不支持 | 单波浪线保持原文 |
| 简单列表/任务列表 | 常见 `-`、`1.`、`[x]` 支持 | 不等同于完整容器规则 |
| 空列表项 / `1)` | 不支持 | 空项被当续行；括号有序列表变段落 |
| 列表嵌套 | 任何比上一层多的前导空白都可能升层，没有按 marker 的 content column 判定 | `- a` 后接一空格 ` - b` 会错误成为嵌套列表 |
| 列表多段 / 续行 | 多段列表项会脱离列表；软续行被保存为 hardBreak | `- first`、空行、`  second` 中第二段成顶层正文 |
| 列表后代码/引用 | 沿用项目的自动展示缩进；相邻无空行时可能显示为跟随块；显式缩进代码仍常是顶层节点 | GFM 以容器列位置和块类型判断，不能仅按空行决定；视觉缩进与列表成员关系不同 |
| 引用 | 常见引用、引用内列表/代码已有支持；空行/lazy continuation/段落边界规则仍有差异 | 不同段落可能合并或拆分；官方边界示例不完整兼容 |
| 表格外侧竖线 | 只认带首尾 `|` 的多列表格 | `A | B` / `--- | ---` / `x | y` 和单列表格均退化成正文 |
| 表格列数 | 表头和分隔行数量不相等时仍补齐建表 | GFM 要求两者列数相等才成立；这里错误建表 |
| 表格 pipe / 换行 | 未转义的代码 span 内 `|` 被保护而不分列；单元格 `<br>` 未渲染 | 与 GFM 表格级分割规则不同；自身导出的 `<br>` 也不能正确读回 |
| 内联链接 | 简单 `[x](url)` 支持；title、空目标、平衡括号、复杂标签不完整 | `[x](https://example.com/a_(b))` 目标截断；`[x](url "Title")` 把 title 加进 href |
| 引用式链接 | 不支持定义解析与 label 匹配 | `[label][id]` 与 `[id]: url` 原样显示并在导出时转义 |
| 自动链接 | 解析器不支持 `<url>` / 邮箱 / 裸 URL 的完整规则 | TipTap 输入自动链接可能造成编辑与只读入口差异 |
| 图片 | 目标常用形式支持；alt/title 未保留；行内图片变为独立块 | `![description](url "Title")` 把 title 拼入 src、丢失描述并拆开段落 |
| 标题锚点 | 新增中文/大小写/标点/重复标题常用跳转；目录长度限制不影响目标 | 仅提取顶层标题；嵌套标题、HTML 自定义锚点及 emoji/格式化标题边界未完整覆盖 GitHub 行为 |
| 脚注 | 基本引用、文末呈现与回跳已有；定义顺序、ID 字符、多段内容和多次引用不完整；命名 ID 直接显示为上标文字 | `[^中文]` 不识别；多段第二段进入正文；重复引用产生重复 DOM ID，仅一个回跳目的地；`[^a]` 显示 a 而非数字序号 |
| 脚注转义 | 为修复历史自动转义而容忍反斜线前缀 | `\[^a]` 仍变脚注，无法表达本应转义的字面量 |
| 数学 | `$…$`、`$$…$$` 与项目 `\(…\)` 支持；本地 KaTeX，而 GitHub 用 MathJax | GitHub `$` 加反引号写法把反引号传入公式；`math` 围栏当代码，不渲染公式；宏覆盖范围也不相同 |
| HTML | 有意只支持受限 `<mark>` / `<details>`，不执行任意 HTML | `<br>`、`<sub>`、`<sup>`、`<ins>`、HTML comment、自定义 anchor 等不呈现为 GitHub 对应效果 |
| details 边界 | summary 紧邻 details 的常见形式支持；空行和嵌套不完整 | 官方示例 details 后的空行使 summary 成正文/标题回退；嵌套在第一个结束标签提前关闭 |
| GitHub alerts | 不支持专门的 NOTE/TIP 等呈现 | `[!NOTE]` 留在普通引用中并被转义导出 |
| Mermaid | 常用 `mermaid` 围栏支持，版本/安全配置可能与 GitHub 不同 | 不保证所有高级图表语法与 GitHub 完全一致；其他 GitHub 图类型也未实现 |
| 网站功能 | mention、issue/PR 引用、emoji shortcode、附件 URL 等未仿真 GitHub | 属网站集成功能，不计为基础 GFM 解析缺陷 |
| 项目扩展 | `flow` / `toc` 围栏、`[[文档]]` 输入、手动块缩进、块标题/折叠状态 | 应明确是 Nine Rings 功能；GitHub 可能显示为代码/普通文本，Markdown 导出也不保存全部 UI 属性 |

## 平台和导出一致性

- 当前文档工具栏和 App 导出调用 TypeScript 的 `exportDocumentMarkdown`；Web 与 Tauri 都走它，再按平台下载或调用文件对话框。因此不能把后端旧导出的问题描述为当前工具栏已经丢内容。
- **Rust 后端仍保留另一份序列化器**（`src-tauri/src/export/mod.rs`），由存储适配器的 `exportNoteMarkdown` / `export_note_markdown` 暴露。它不支持新版脚注、数学、details、嵌套引用 embed，任务状态和部分代码转义也缺失。实际调用该旧 API 会产生不一致/缺内容风险；本次由代码确认，未改后端、未新增原生构建。JSON 备份的原始 Delta 导出是另一条路径，不能混为 Markdown 导出的丢失问题。
- Flutter 的 `flutter_app/lib/services/note_service.dart` 还保留旧解析/导出实现，未跟上 TypeScript 的表格、脚注、数学与受限 HTML；“与 Web 对齐”的注释已经不准确。按当前用户要求，只进行源码审查，不安装 Flutter、不运行 Flutter 测试。
- Python 批量导入脚本 `scripts/md-to-nine-rings.py` 也有独立的旧解析器。额外对同一 702 个输入执行解析，无异常，但 H4–H6、嵌套列表、任务状态和新 embed 不支持，且所有代码围栏的语言信息都会丢失，Mermaid/flow/toc 因而无法按对应类型识别。代码 fence 文本保留不等于图表功能保留。其输出未附带原始 Markdown 元数据；同一文件通过设置页和 CLI 导入会产生不同结果。

## 建议修复顺序

1. **优先保内容与目标正确**：链接/title/图片描述、硬换行、多段/重复脚注、列表容器与代码空白，以及 TypeScript/Rust 导出契约。把本次最小复现转为正常语义的回归测试，不把当前错误表现固化为测试预期。
2. **采用标准解析内核**：评估成熟 CommonMark/GFM tokenizer 或 AST（如 markdown-it 的 CommonMark 基线加 GFM 扩展，或 remark-parse + remark-gfm），通过一处适配层生成既有 Delta/PM 模型。脚注、math、受限 HTML、flow/toc 作为显式扩展；保留源码位置用于搜索/滚动，不给不同视图各加一套正则补丁。选型需要先测大文档成本、包体积及 Worker 适用性，不能仅更换依赖名称。
3. **对齐往返和所有入口**：导入/粘贴/源码/模板/flow 统一语法，源文未改时保留原始拼写；渲染编辑后的结构化序列化保证语义不变。分清“源码字节完全相同”“语义不变”“UI 状态保留”三个目标。
4. **独立声明兼容范围**：受限 HTML、手动缩进与 flow/toc 的差异可以保留，但普通 GFM 不应被这些便利规则误解。GitHub alerts、math 围栏等可再分批支持，网站的 mention/issue 服务不必仿真。

## 范围限制

本次覆盖官方案例全集的解析与模型往返，并对定向差异进行源码和实际 DOM 核查；不是 GitHub 线上逐例截图比对，不是完整产品 E2E，不包含原生 macOS IME、Flutter 或 Linux/Windows 原生执行。自动语义比较仍有误报/漏报可能，报告中的具体问题均以定向输入和实际实现再次确认。
