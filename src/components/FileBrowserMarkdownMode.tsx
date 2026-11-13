import { ToolbarIcon } from "./ToolbarIcon";

/** A shared icon toggle; the icon and tooltip describe the target mode. */
export function FileBrowserMarkdownMode({ rendered, onChange, disabled = false }: { rendered: boolean; onChange: (rendered: boolean) => void; disabled?: boolean }) {
  return <button type="button" className="btn-icon" aria-label={rendered ? "切换到 Markdown 源码" : "切换到 Markdown 渲染"} title={rendered ? "查看源码" : "查看渲染结果"} aria-pressed={rendered} disabled={disabled} onClick={() => onChange(!rendered)}><ToolbarIcon name={rendered ? "code" : "eye"} /></button>;
}
