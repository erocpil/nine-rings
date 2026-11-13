/** Shared, explicit mode choice for compact and full-view file previews. */
export function FileBrowserMarkdownMode({ rendered, onChange, disabled = false }: { rendered: boolean; onChange: (rendered: boolean) => void; disabled?: boolean }) {
  return <span className="file-browser-preview-modes" role="group" aria-label="Markdown 预览模式">
    <button type="button" className="btn-icon" aria-label="Markdown 渲染预览" title="查看 Markdown 渲染结果" aria-pressed={rendered} disabled={disabled} onClick={() => onChange(true)}>渲染</button>
    <button type="button" className="btn-icon" aria-label="Markdown 源码预览" title="查看 Markdown 原始源码" aria-pressed={!rendered} disabled={disabled} onClick={() => onChange(false)}>源码</button>
  </span>;
}
