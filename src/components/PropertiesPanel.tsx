import { useState, useEffect, useCallback, useRef } from "react";
import type { AppConfig, DeltaOps, DocumentMetadata, ExternalMarkdownSource, Note, DocType } from "../types/models";
import { api } from "../lib/api";
import MoveToDialog from "./MoveToDialog";
import {
  downloadExternalMarkdown,
  markdownContentFingerprint,
  normalizeExternalMarkdownUrl,
  resolveMarkdownResourceUrls,
} from "../lib/external-markdown-source";
import { transformMarkdownSource } from "../lib/data-transform-client";
import { extractPlainText } from "../lib/storage/core";

interface PropertiesPanelProps {
  note: Note;
  onNoteUpdate: (note: Note) => void;
  onClose: () => void;
  readonly?: boolean;
  readonlyChangeDisabled?: boolean;
  onMetadataUpdate: (metadata: DocumentMetadata) => Promise<void>;
  onMoveDocument: (id: string, targetPath: string) => Promise<void>;
  onExportPdf: () => void;
  onExternalMarkdownApply: (content: DeltaOps, source: ExternalMarkdownSource) => Promise<void>;
  onExternalMarkdownDetach: () => Promise<void>;
  externalSourceActionsDisabled?: boolean;
  /** 点击概念标签时，跳转到该概念的聚合页 */
  onOpenConcept?: (concept: string) => void;
}

const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: "explanation", label: "📖 解释" },
  { value: "how-to", label: "🔧 指南" },
  { value: "reference", label: "📋 参考" },
  { value: "tutorial", label: "🎓 教程" },
];

const PATH_ROOT_OPTIONS = [
  { value: "projects", label: "📁 Projects" },
  { value: "areas", label: "🧩 Areas" },
  { value: "references", label: "📚 References" },
  { value: "ideas", label: "💡 Ideas" },
  { value: "archives", label: "📦 Archives" },
];

interface ExternalSourcePreview {
  title: string;
  content: DeltaOps;
  source: ExternalMarkdownSource;
  bytes: number;
  lines: number;
  excerpt: string;
  remoteChanged: boolean;
  localModified: boolean;
}

function PropertiesPanel({ note, onNoteUpdate, onClose, readonly, readonlyChangeDisabled, onMetadataUpdate, onMoveDocument, onExportPdf, onExternalMarkdownApply, onExternalMarkdownDetach, externalSourceActionsDisabled, onOpenConcept }: PropertiesPanelProps) {
  const [conceptInput, setConceptInput] = useState("");
  const [existingConcepts, setExistingConcepts] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<Note[]>([]);
  const [backlinks, setBacklinks] = useState<Note[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [readonlySaving, setReadonlySaving] = useState(false);
  const [readonlyError, setReadonlyError] = useState<string | null>(null);
  const [userConfig, setUserConfig] = useState<AppConfig | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<DocumentMetadata>(() => note.content.metadata ?? {});
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataMessage, setMetadataMessage] = useState<string | null>(null);
  const externalSource = note.content.metadata?.externalSource;
  const [sourceUrl, setSourceUrl] = useState(externalSource?.url ?? "");
  const [sourcePreview, setSourcePreview] = useState<ExternalSourcePreview | null>(null);
  const [sourceBusy, setSourceBusy] = useState<"fetch" | "apply" | "detach" | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const sourceAbortRef = useRef<AbortController | null>(null);

  const concepts = note.concepts ?? [];
  const linkedIds = note.linkedDocIds ?? [];
  const pathRoot = note.storagePath?.split("/")[0] ?? "";
  const pathRest = note.storagePath?.split("/").slice(1).join("/") ?? "";
  const metadataSignature = JSON.stringify(note.content.metadata ?? {});

  const handleReadonlyChange = useCallback(async (nextReadonly: boolean) => {
    if (readonlyChangeDisabled || readonlySaving) return;
    setReadonlySaving(true);
    setReadonlyError(null);
    try {
      const updated = await api.notes.update(note.id, { readonly: nextReadonly });
      onNoteUpdate(updated);
    } catch (error) {
      setReadonlyError(`设置失败：${(error as Error).message}`);
    } finally {
      setReadonlySaving(false);
    }
  }, [note.id, onNoteUpdate, readonlyChangeDisabled, readonlySaving]);

  const loadBacklinks = useCallback(async () => {
    try {
      // 旧实现先读取全部日期，再逐日查询正文；大备份会产生数百甚至数千次
      // 串行 IPC。随笔和文档各读取一次即可完成同一项反链筛选。
      const [dailyNotes, docs] = await Promise.all([
        api.notes.all(),
        api.docs.listByPath(""),
      ]);
      const results = new Map<string, Note>();
      for (const candidates of [dailyNotes, docs]) {
        for (const candidate of candidates) {
          if ((candidate.linkedDocIds ?? []).includes(note.id)) {
            results.set(candidate.id, candidate);
          }
        }
      }
      setBacklinks([...results.values()]);
    } catch {
      setBacklinks([]);
    }
  }, [note.id]);

  useEffect(() => {
    api.docs.allConcepts().then(setExistingConcepts);
    api.config.get().then(setUserConfig).catch(() => setUserConfig(null));
    void loadBacklinks();
  }, [loadBacklinks]);

  useEffect(() => {
    setMetadataDraft(JSON.parse(metadataSignature) as DocumentMetadata);
    setMetadataMessage(null);
  }, [metadataSignature, note.id]);

  useEffect(() => {
    sourceAbortRef.current?.abort();
    setSourceUrl(externalSource?.url ?? "");
    setSourcePreview(null);
    setSourceMessage(null);
    setSourceBusy(null);
    return () => sourceAbortRef.current?.abort();
  }, [externalSource?.url, note.id]);

  const checkExternalSource = async () => {
    if (sourceBusy || externalSourceActionsDisabled) return;
    setSourceBusy("fetch");
    setSourceMessage(null);
    setSourcePreview(null);
    const controller = new AbortController();
    sourceAbortRef.current?.abort();
    sourceAbortRef.current = controller;
    try {
      const normalized = normalizeExternalMarkdownUrl(sourceUrl);
      const download = await downloadExternalMarkdown(normalized.originalUrl, { signal: controller.signal });
      const rewritten = resolveMarkdownResourceUrls(download.source, download.resolvedUrl);
      const transformed = await transformMarkdownSource(download.fileName, rewritten);
      const localContentHash = markdownContentFingerprint(JSON.stringify(transformed.content.ops ?? []));
      const currentLocalHash = markdownContentFingerprint(JSON.stringify(note.content.ops ?? []));
      const sameBinding = externalSource
        && normalizeExternalMarkdownUrl(externalSource.url).requestUrl === normalized.requestUrl;
      const remoteChanged = !sameBinding || externalSource.contentHash !== download.contentHash;
      const localModified = Boolean(sameBinding && externalSource.localContentHash !== currentLocalHash);
      const nextSource: ExternalMarkdownSource = {
        kind: "markdown-url",
        url: normalized.originalUrl,
        resolvedUrl: download.resolvedUrl,
        provider: download.provider,
        contentHash: download.contentHash,
        localContentHash,
        ...(download.etag ? { etag: download.etag } : {}),
        ...(download.lastModified ? { lastModified: download.lastModified } : {}),
        syncedAt: new Date().toISOString(),
      };
      const plainText = extractPlainText(transformed.content);
      setSourcePreview({
        title: transformed.title,
        content: transformed.content,
        source: nextSource,
        bytes: download.bytes,
        lines: download.source.replace(/\r\n?/g, "\n").split("\n").length,
        excerpt: plainText.slice(0, 500),
        remoteChanged,
        localModified,
      });
      setSourceMessage(remoteChanged
        ? "已获取远端内容，请确认预览后更新"
        : localModified
          ? "远端未变化，但本地正文在上次同步后已修改"
          : "远端内容与上次同步一致");
    } catch (error) {
      if (!controller.signal.aborted) setSourceMessage(`获取失败：${(error as Error).message}`);
    } finally {
      if (sourceAbortRef.current === controller) sourceAbortRef.current = null;
      setSourceBusy(null);
    }
  };

  const applyExternalSource = async () => {
    if (!sourcePreview || sourceBusy || externalSourceActionsDisabled) return;
    const warning = sourcePreview.localModified
      ? "本地正文在上次同步后已修改。继续会用远端内容覆盖本地正文，但可从版本历史恢复。确认继续？"
      : "将用预览中的远端 Markdown 替换本地正文，并在更新前创建版本。确认继续？";
    if (!window.confirm(warning)) return;
    setSourceBusy("apply");
    setSourceMessage(null);
    try {
      await onExternalMarkdownApply(sourcePreview.content, sourcePreview.source);
      setSourcePreview(null);
      setSourceMessage("已更新本地正文并保存来源信息");
    } catch (error) {
      setSourceMessage(`更新失败：${(error as Error).message}`);
    } finally {
      setSourceBusy(null);
    }
  };

  const detachExternalSource = async () => {
    if (!externalSource || sourceBusy || externalSourceActionsDisabled) return;
    if (!window.confirm("解除外部来源关联？当前本地正文会保留。")) return;
    setSourceBusy("detach");
    setSourceMessage(null);
    try {
      await onExternalMarkdownDetach();
      setSourcePreview(null);
      setSourceUrl("");
      setSourceMessage("已解除来源关联，本地正文保持不变");
    } catch (error) {
      setSourceMessage(`解除失败：${(error as Error).message}`);
    } finally {
      setSourceBusy(null);
    }
  };

  const updateMetadataField = <K extends keyof DocumentMetadata,>(key: K, value: DocumentMetadata[K]) => {
    setMetadataDraft((current) => ({ ...current, [key]: value }));
    setMetadataMessage(null);
  };

  const fillUserDefaults = () => {
    if (!userConfig || readonly) return;
    setMetadataDraft((current) => ({
      ...current,
      author: current.author || userConfig.user_name,
      organization: current.organization || userConfig.user_organization,
      email: current.email || userConfig.user_email,
      website: current.website || userConfig.user_website,
      copyright: current.copyright || userConfig.user_copyright,
      language: current.language || userConfig.user_default_language,
      license: current.license || userConfig.user_default_license,
    }));
    setMetadataMessage("已填充用户信息中的空缺项，请保存");
  };

  const saveMetadata = async () => {
    if (readonly || metadataSaving) return;
    setMetadataSaving(true);
    setMetadataMessage(null);
    const cleaned = Object.fromEntries(Object.entries(metadataDraft).filter(([, value]) =>
      Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim().length > 0 : value != null,
    )) as DocumentMetadata;
    try {
      await onMetadataUpdate(cleaned);
      setMetadataDraft(cleaned);
      setMetadataMessage("元信息已保存");
    } catch (error) {
      setMetadataMessage(`保存失败：${(error as Error).message}`);
    } finally {
      setMetadataSaving(false);
    }
  };

  // ── 类型变更（toggle：点击已选中 → 取消）──

  const handleTypeChange = useCallback(async (docType: DocType) => {
    if (readonly) return;
    const newType = note.docType === docType ? undefined : docType;
    await api.notes.update(note.id, { docType: newType });
    onNoteUpdate({ ...note, docType: newType });
  }, [note, onNoteUpdate, readonly]);

  // ── 概念 ──

  const handleConceptInput = (value: string) => {
    setConceptInput(value);
    if (value.trim()) {
      setSuggestions(
        existingConcepts.filter(
          (c) => c.includes(value.trim()) && !concepts.includes(c)
        )
      );
    } else {
      setSuggestions([]);
    }
  };

  const addConcept = async (tag: string) => {
    if (readonly) return;
    const t = tag.trim();
    if (!t || concepts.includes(t)) return;
    const updated = [...concepts, t];
    await api.notes.update(note.id, { concepts: updated });
    onNoteUpdate({ ...note, concepts: updated });
    setConceptInput("");
    setSuggestions([]);
  };

  const removeConcept = async (tag: string) => {
    if (readonly) return;
    const updated = concepts.filter((c) => c !== tag);
    await api.notes.update(note.id, { concepts: updated });
    onNoteUpdate({ ...note, concepts: updated });
  };

  // ── 链接 ──

  const handleLinkSearch = async (value: string) => {
    setLinkSearch(value);
    if (value.trim().length >= 1) {
      const results = await api.notes.search(value);
      setLinkResults(
        results.filter((n) => n.id !== note.id && !linkedIds.includes(n.id))
      );
    } else {
      setLinkResults([]);
    }
  };

  const addLink = async (linkedNote: Note) => {
    if (readonly) return;
    const updated = [...linkedIds, linkedNote.id];
    await api.notes.update(note.id, { linkedDocIds: updated });
    onNoteUpdate({ ...note, linkedDocIds: updated });
    setLinkSearch("");
    setLinkResults([]);
  };

  const removeLink = async (id: string) => {
    if (readonly) return;
    const updated = linkedIds.filter((lid) => lid !== id);
    await api.notes.update(note.id, { linkedDocIds: updated });
    onNoteUpdate({ ...note, linkedDocIds: updated });
  };

  if (!note.storagePath) return null;

  return (
    <>
    <div className="properties-panel">
      <div className="properties-header">
        <span className="properties-title">属性</span>
        <button className="btn-icon properties-close" onClick={onClose} title="关闭属性面板">✕</button>
      </div>

      <div className="properties-body">
        {/* 位置 */}
        <div className="prop-section">
          <div className="prop-label">位置</div>
          <button type="button" className="prop-path" onClick={() => setMoveOpen(true)} disabled={readonly} title={readonly ? undefined : "移动到其他目录"}>
            <span className="prop-path-icon">{PATH_ROOT_OPTIONS.find(o => o.value === pathRoot)?.label ?? "📂"}</span>
            {pathRest && <span className="prop-path-text">/ {pathRest}</span>}
            {!readonly && <span className="prop-path-edit-icon">↗</span>}
          </button>
        </div>

        {/* 访问权限：即使文档已经只读，也必须保留取消只读的入口。 */}
        <div className="prop-section">
          <div className="prop-label">访问权限</div>
          <label className={`settings-toggle prop-readonly-toggle ${readonlySaving ? "saving" : ""}`}>
            <input
              type="checkbox"
              checked={note.readonly}
              disabled={readonlyChangeDisabled || readonlySaving}
              onChange={(event) => { void handleReadonlyChange(event.target.checked); }}
            />
            <span className="toggle-track" />
            <span className="toggle-label">{readonlySaving ? "保存中…" : note.readonly ? "只读" : "可编辑"}</span>
          </label>
          {readonlyError && <div className="prop-inline-error" role="alert">{readonlyError}</div>}
        </div>

        {/* 类型 */}
        <div className="prop-section">
          <div className="prop-label">类型</div>
          <div className="prop-type-options" role="radiogroup" aria-label="文档类型">
            {DOC_TYPE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`prop-type-btn ${note.docType === o.value ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name={`prop-type-${note.id}`}
                  className="prop-type-radio"
                  value={o.value}
                  checked={note.docType === o.value}
                  disabled={readonly}
                  onChange={() => handleTypeChange(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        {/* 发布元信息 */}
        <div className="prop-section">
          <div className="prop-label">发布元信息</div>
          <div className="prop-metadata-grid">
            <input className="prop-input" aria-label="作者" placeholder={userConfig?.user_name ? `作者（默认：${userConfig.user_name}）` : "作者"} value={metadataDraft.author ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("author", event.target.value)} />
            <input className="prop-input" aria-label="组织" placeholder={userConfig?.user_organization ? `组织（默认：${userConfig.user_organization}）` : "组织"} value={metadataDraft.organization ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("organization", event.target.value)} />
            <input className="prop-input" type="email" aria-label="邮箱" placeholder="联系邮箱" value={metadataDraft.email ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("email", event.target.value)} />
            <input className="prop-input" type="url" aria-label="网站" placeholder="作者网站" value={metadataDraft.website ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("website", event.target.value)} />
            <input className="prop-input" aria-label="语言" placeholder={userConfig?.user_default_language ? `语言（默认：${userConfig.user_default_language}）` : "语言，例如 zh-CN"} value={metadataDraft.language ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("language", event.target.value)} />
            <input className="prop-input" aria-label="版本" placeholder="文档版本，例如 1.0" value={metadataDraft.version ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("version", event.target.value)} />
            <input className="prop-input prop-metadata-wide" aria-label="关键词" placeholder="关键词，使用逗号分隔" value={(metadataDraft.keywords ?? []).join(", ")} disabled={readonly} onChange={(event) => updateMetadataField("keywords", event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))} />
            <textarea className="prop-input prop-metadata-wide prop-metadata-summary" aria-label="摘要" placeholder="文档摘要" value={metadataDraft.summary ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("summary", event.target.value)} />
            <input className="prop-input prop-metadata-wide" aria-label="许可证" placeholder={userConfig?.user_default_license ? `许可证（默认：${userConfig.user_default_license}）` : "许可证，例如 CC BY 4.0"} value={metadataDraft.license ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("license", event.target.value)} />
            <input className="prop-input prop-metadata-wide" aria-label="版权声明" placeholder="版权声明" value={metadataDraft.copyright ?? ""} disabled={readonly} onChange={(event) => updateMetadataField("copyright", event.target.value)} />
          </div>
          <div className="prop-metadata-actions">
            <button type="button" className="settings-sm-btn" disabled={readonly || !userConfig} onClick={fillUserDefaults}>填充用户默认值</button>
            <button type="button" className="settings-sm-btn" disabled={readonly || metadataSaving} onClick={() => { void saveMetadata(); }}>{metadataSaving ? "保存中…" : "保存元信息"}</button>
          </div>
          {metadataMessage && <div className="prop-metadata-message" role="status">{metadataMessage}</div>}
          <div className="prop-system-metadata">
            <span>创建：{new Date(note.created_at).toLocaleString()}</span>
            <span>更新：{new Date(note.updated_at).toLocaleString()}</span>
          </div>
        </div>

        <div className="prop-section">
          <div className="prop-label">导出</div>
          <button
            type="button"
            className="settings-btn-secondary"
            onClick={onExportPdf}
            title="按展开后的完整正文生成 PDF，标题用于生成查看器侧栏书签"
          >导出 PDF（书签大纲）</button>
          <div className="prop-empty">
            正文不会插入目录页；标题层级用于生成 PDF 查看器侧栏中的可点击书签（具体支持由系统 PDF 打印引擎决定）。使用上方发布元信息；只读文档也可以导出。iPhone/iPad 无需打印机：在系统打印预览中展开页面，再点分享并“存储到文件”。
          </div>
        </div>

        <div className="prop-section prop-external-source">
          <div className="prop-label">外部来源</div>
          <input
            className="prop-input prop-source-url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="外部 Markdown URL"
            placeholder="https://github.com/owner/repo/blob/main/README.md"
            value={sourceUrl}
            disabled={Boolean(sourceBusy || externalSourceActionsDisabled)}
            onChange={(event) => {
              setSourceUrl(event.target.value);
              setSourcePreview(null);
              setSourceMessage(null);
            }}
          />
          <div className="prop-source-actions">
            <button
              type="button"
              className="settings-sm-btn"
              disabled={!sourceUrl.trim() || Boolean(sourceBusy || externalSourceActionsDisabled)}
              onClick={() => { void checkExternalSource(); }}
            >{sourceBusy === "fetch" ? "获取中…" : "获取并预览"}</button>
            {externalSource && (
              <button
                type="button"
                className="settings-sm-btn prop-source-detach"
                disabled={Boolean(sourceBusy || externalSourceActionsDisabled)}
                onClick={() => { void detachExternalSource(); }}
              >{sourceBusy === "detach" ? "解除中…" : "解除关联"}</button>
            )}
          </div>
          {externalSource && (
            <div className="prop-source-status">
              <span>{externalSource.provider === "github" ? "GitHub" : "URL"}</span>
              <span>同步于 {new Date(externalSource.syncedAt).toLocaleString()}</span>
            </div>
          )}
          {sourcePreview && (
            <div className="prop-source-preview">
              <strong title={sourcePreview.title}>{sourcePreview.title || "无标题"}</strong>
              <span>{Math.max(1, Math.ceil(sourcePreview.bytes / 1024))} KiB · {sourcePreview.lines} 行</span>
              {sourcePreview.excerpt && <p>{sourcePreview.excerpt}</p>}
              {sourcePreview.localModified && (
                <div className="prop-source-warning">本地正文在上次同步后已修改，更新将覆盖这些修改。</div>
              )}
              {(sourcePreview.remoteChanged || sourcePreview.localModified) ? (
                <button
                  type="button"
                  className="settings-btn-secondary"
                  disabled={Boolean(sourceBusy || externalSourceActionsDisabled)}
                  onClick={() => { void applyExternalSource(); }}
                >{sourceBusy === "apply" ? "更新中…" : sourcePreview.remoteChanged ? "更新本地内容" : "恢复远端内容"}</button>
              ) : null}
            </div>
          )}
          {sourceMessage && (
            <div className={`prop-source-message ${sourceMessage.startsWith("获取失败") || sourceMessage.startsWith("更新失败") || sourceMessage.startsWith("解除失败") ? "error" : ""}`} role="status">
              {sourceMessage}
            </div>
          )}
          <div className="prop-empty">公开 Markdown 来源；只读文档也可手动更新。普通网站需要允许浏览器跨域读取。</div>
        </div>

        {/* 概念标签 */}
        <div className="prop-section">
          <div className="prop-label">概念</div>
          <div className="prop-tags-input-row">
            <input
              type="text"
              className="prop-input"
              placeholder="添加概念..."
              value={conceptInput}
              disabled={readonly}
              onChange={(e) => handleConceptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addConcept(conceptInput);
                }
              }}
            />
            {suggestions.length > 0 && (
              <div className="prop-suggestions">
                {suggestions.map((s) => (
                  <button type="button" key={s} className="prop-suggestion" onClick={() => addConcept(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          {concepts.length > 0 && (
            <div className="prop-tags">
              {concepts.map((c) => (
                <span key={c} className="prop-tag">
                  <button
                    type="button"
                    className="prop-tag-name"
                    onClick={onOpenConcept ? () => onOpenConcept(c) : undefined}
                    disabled={!onOpenConcept}
                    title={onOpenConcept ? `查看 #${c} 的所有文档` : undefined}
                  >
                    {c}
                  </button>
                  <button className="prop-tag-remove" onClick={() => removeConcept(c)}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 关联文档 */}
        <div className="prop-section">
          <div className="prop-label">
            关联文档
            <span className="prop-count">{linkedIds.length}</span>
          </div>
          {linkedIds.length > 0 && (
            <div className="prop-links">
              {linkedIds.map((lid) => (
                <LinkedNoteItem
                  key={lid}
                  noteId={lid}
                  onRemove={removeLink}
                />
              ))}
            </div>
          )}
          <div className="prop-tags-input-row">
            <input
              type="text"
              className="prop-input"
              placeholder="搜索并关联文档..."
              value={linkSearch}
              disabled={readonly}
              onChange={(e) => handleLinkSearch(e.target.value)}
            />
            {linkResults.length > 0 && (
              <div className="prop-suggestions">
                {linkResults.map((r) => (
                  <button type="button" key={r.id} className="prop-suggestion" onClick={() => addLink(r)}>
                    <span className="prop-link-title">{r.title || "无标题"}</span>
                    <span className="prop-link-date">{r.date}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 反向链接 */}
        <div className="prop-section">
          <div className="prop-label">
            反向链接
            <span className="prop-count">{backlinks.length}</span>
          </div>
          {backlinks.length === 0 ? (
            <div className="prop-empty">暂无其他笔记引用此文档</div>
          ) : (
            <div className="prop-links">
              {backlinks.map((n) => (
                <div key={n.id} className="prop-link-item">
                  <span className="prop-link-title" title={n.title ?? ""}>{n.title || "无标题"}</span>
                  <span className="prop-link-date">{n.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    {moveOpen && (
      <MoveToDialog
        subject={{
          kind: "document",
          noteId: note.id,
          title: note.title || "无标题",
          currentPath: note.storagePath,
        }}
        onClose={() => setMoveOpen(false)}
        onMove={(targetPath) => onMoveDocument(note.id, targetPath)}
      />
    )}
    </>
  );
}

// ── 关联文档项 ──

function LinkedNoteItem({ noteId, onRemove }: { noteId: string; onRemove: (id: string) => void }) {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    api.notes.get(noteId).then(setNote);
  }, [noteId]);

  if (!note) return <div className="prop-link-item loading">...</div>;

  return (
    <div className="prop-link-item">
      <span className="prop-link-title" title={note.title ?? ""}>{note.title || "无标题"}</span>
      <button className="prop-tag-remove" onClick={() => onRemove(noteId)}>✕</button>
    </div>
  );
}

export default PropertiesPanel;
