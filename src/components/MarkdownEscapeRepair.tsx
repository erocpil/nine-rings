import { useState } from "react";
import {
  scanMarkdownEscapes,
  applyMarkdownEscapeRepairs,
} from "../lib/markdown-escape-repair";

export function MarkdownEscapeRepair({
  source,
  disabled,
  onApply,
}: {
  source: string;
  disabled: boolean;
  onApply: (before: string, after: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const candidates = preview === null ? [] : scanMarkdownEscapes(preview);
  return (
    <div className="markdown-escape-repair">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setPreview(source);
          setSelected(new Set());
          setError("");
        }}
      >
        扫描历史任务转义
      </button>
      {preview !== null && (
        <section aria-label="转义修复预览">
          <p>
            仅扫描当前文档的任务标记，跳过代码块。以下也可能是刻意转义，请逐项确认。应用前会保存版本快照。
          </p>
          {candidates.length === 0 && (
            <p role="status">没有发现可修复的任务标记。</p>
          )}
          {candidates.map((candidate) => (
            <label key={candidate.line} style={{ display: "block" }}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.has(candidate.line)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(candidate.line);
                  else next.delete(candidate.line);
                  setSelected(next);
                }}
              />
              第 {candidate.line + 1} 行
              <pre style={{ whiteSpace: "pre-wrap" }}>
                − {candidate.before}
                {"\n"}+ {candidate.after}
              </pre>
            </label>
          ))}
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            disabled={disabled || !selected.size || preview !== source}
            onClick={async () => {
              try {
                await onApply(
                  preview,
                  applyMarkdownEscapeRepairs(
                    preview,
                    candidates.filter((item) => selected.has(item.line)),
                  ),
                );
                setPreview(null);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              }
            }}
          >
            保存快照并修复所选项
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPreview(null)}
          >
            取消修复
          </button>
          {preview !== source && <p role="status">正文已变化，请重新扫描。</p>}
        </section>
      )}
    </div>
  );
}
