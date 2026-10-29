# 共享文档渲染

更新：2026-10-28。

普通 Markdown 的数据库和磁盘入口现已接入同一个 `RenderedDocumentWorkspace`，不再各自维护阅读会话。完整分层、能力边界与保真策略见 [统一文档工作区](unified-document-workspace.md)。

## 公共实现

- `documentRenderingExtensions` 是共同 schema／NodeView 来源；`DocumentRenderBody` 与 `DocumentEditorContent` 挂载完整正文和 React portal。
- 编号插件、`EditorBlockGutter`、批量及单章节折叠、工具栏、选区／右键／块菜单、目录／书签、状态栏使用公共工作区实现。
- `ReadingBlockSession` 持有设备上的代码／引用等阅读覆盖值。普通布局不再以 `.vr-row/.vr-block` 包装每个磁盘块，所有风格使用同一 CSS 邻接规则。
- `DocumentResourceContext` 为相对资源提供显示解析，文档模型不替换成临时授权地址；并排静态预览沿用相同资源边界。
- `DocumentSourceSurface`、`MarkdownSourceEditor` 和 `MarkdownSplitPreview` 统一源码及并排派生预览；预览不能独立保存正文。

`LocalMarkdownWorkspace` 只做文件来源适配：原文、延迟编辑投影、读写／草稿冲刷、书签行偏移和资源授权。`DocumentReadingView`、`MarkdownReadingView` 已由公共工作区替代并删除。数据库保护与同步仍在数据库外包装器中。

## 内容与会话约束

- 当前富文本由一份 ProseMirror 模型拥有。真实正文 DOM 保留跨块选区、复制、输入法和撤销，不为每个块创建独立编辑器。
- 磁盘原文仅在实际富文本编辑后序列化；完整撤销至初始模型恢复初始原文。源码模式仍直接反映原始字符串。代码／引用的只读显示事务不改写磁盘正文。
- 配置、字体和编号插件通过相同的组件及 CSS 生效，来源适配器不补另一套块间距。
- 只读门禁同时约束用户输入、原生粘贴和程序化命令。通用菜单按能力展示，不创建不可解析的数据库引用。
- 位置恢复期间不保存中间夹取值；真实导航取消恢复。未操作源码的往返同时保留外层视口及有界引用／代码等内部滚动。
- 单独保存文件的编码、换行、版本核验及写入失败处理必须留在文件服务。不能因查看或渲染就取得额外写权限。

## 验证

`e2e/local-reading-spacing.spec.ts` 在相同只读权限下比较数据库和磁盘的相邻块几何、字体与行高，覆盖经典及七种风格、390px／1280px、连续标题、段落、列表、代码、引用、分隔线和 HTML 折叠。

`e2e/local-markdown-rendering.spec.ts` 验证只读门禁、代码行号、块模式、查找跳转、书签、脚注、目录、原文往返及阅读状态。`e2e/local-markdown-editing.spec.ts` 覆盖真实的可写目录夹具、富文本编辑与完整撤销、立即保存、相对图片、重命名和未保存保护。

源码／渲染位置、嵌套引用内滚动和手机统一标题使用既有跨模式回归。不能把针对性验证等同于完整 E2E 或原生权限／IME 验收，结果见 [验证记录](e2e-repair-progress.md)。

实验性局部只读渲染保持独立的受控能力，默认不开启，也未隐式用于磁盘文件。此重构优先消除行为分叉，不据此宣称大文件首屏或内存已有性能改善。
