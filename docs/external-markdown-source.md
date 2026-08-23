# 外部 Markdown 来源

## 目标

文档可以绑定一个公开的 Markdown URL。用户在属性页检查来源、预览远端内容，确认后用远端 Markdown 更新本地正文。典型来源是 GitHub 仓库中的 `README.md`。

该功能是“受控刷新本地副本”，不是实时在线编辑，也不是 GitHub 备份功能的另一种入口。

## 第一版范围

- 仅用于文档视图中的文档；入口位于属性页“外部来源”。
- 支持 `http://`、`https://`，以及 GitHub `blob/.../*.md`、`raw/.../*.md` 和 `raw.githubusercontent.com` URL。
- GitHub 页面 URL会规范化为公开 raw URL；普通 URL要求目标站点允许浏览器跨域读取。
- 下载前校验协议、响应类型和大小；第一版上限为 3 MiB，超时 15 秒。
- 下载与 Markdown 转换分离。转换在现有数据 worker 中执行，避免长 README 阻塞手机界面。
- 预览显示远端标题、大小、行数和正文摘要。用户明确确认后才替换本地正文。
- 替换前冲刷自动保存并创建版本快照；解析或保存失败时保留原正文。
- 保留本地文档标题、标签、分类、概念、关联文档、发布元信息和书签。
- 来源 URL、最终 URL、内容指纹、同步后本地内容指纹和同步时间随文档备份。
- 可解除来源关联；解除后保留当前本地正文。
- 相对 Markdown 链接和图片地址按最终来源 URL转换为绝对地址。
- 第一版为手动检查和更新，不在后台静默覆盖本地内容。

## 更新规则

1. 属性页获取 URL。
2. 来源适配器规范化 GitHub URL，下载并验证 Markdown。
3. 相对资源 URL以最终响应 URL为基准重写。
4. worker 将 Markdown 转换为 Delta，并生成预览信息。
5. 如果远端内容指纹和上次同步一致，显示“远端内容未变化”，不写数据库。
6. 如果同步后本地正文被编辑，更新前给出额外覆盖警告。
7. 用户确认后依次执行：冲刷自动保存、重新读取当前文档、创建版本快照、合并原元信息、更新正文、刷新编辑器和搜索索引。

只读文档仍可执行显式的来源更新，因为这是用户主动触发的受控同步；普通正文编辑继续受只读限制。同步繁忙时禁用来源操作。

## 数据模型

第一版将来源状态放在 `content.metadata.externalSource`，使 Web IndexedDB、Tauri、版本历史和备份无需增加新的存储列：

```ts
interface ExternalMarkdownSource {
  kind: "markdown-url";
  url: string;
  resolvedUrl: string;
  provider: "github" | "generic";
  contentHash: string;
  localContentHash: string;
  etag?: string;
  lastModified?: string;
  syncedAt: string;
}
```

`contentHash` 用于识别远端是否变化；`localContentHash` 用于识别同步后是否发生本地编辑。正文刷新必须保留 `metadata` 中除此字段以外的全部内容。

## 安全与失败边界

- 不接受 `file:`、`data:`、`javascript:` 等协议。
- 不执行 Markdown 中的原始 HTML 或脚本；外部内容仍转换为应用自身的结构化文档。
- 不复用 GitHub 备份 Token访问任意 URL，避免凭据被发送到错误主机。第一版只支持公开来源。
- PWA 的 Service Worker不能绕过 CORS；普通站点拒绝跨域时给出明确说明，不建立开放代理。
- 下载、解析、版本创建和本地更新任一步失败都不得破坏当前正文。

## 后续演进

1. 打开文档时使用 ETag/Last-Modified低频检查，只提示“有更新”，仍不自动覆盖。
2. 支持私有 GitHub 文件，并将授权严格限制到用户确认的仓库。
3. 改用懒加载的完整 GFM AST解析器，继续补齐任务列表、脚注、引用式链接和受控 HTML。
4. 提供结构化差异预览、选择性合并和定时同步。
5. 若来源功能稳定且需求明确，再将来源状态迁移为独立的文档字段和同步任务模型。
