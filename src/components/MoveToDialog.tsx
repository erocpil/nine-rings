import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import {
  collectMoveFolderPaths,
  resolveMoveTarget,
  type MoveToSubject,
} from "../lib/move-to";

interface MoveToDialogProps {
  subject: MoveToSubject;
  folderPaths?: string[];
  onClose: () => void;
  onMove: (targetPath: string) => Promise<void>;
}

const MAX_VISIBLE_FOLDERS = 200;

function destinationLabel(subject: MoveToSubject): string {
  return subject.kind === "folder" ? "目标父目录" : "目标目录";
}

export function MoveToDialog({ subject, folderPaths, onClose, onMove }: MoveToDialogProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [loadedPaths, setLoadedPaths] = useState<string[]>(folderPaths ?? []);
  const [loading, setLoading] = useState(folderPaths === undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [destination, setDestination] = useState(() => (
    subject.kind === "document"
      ? subject.currentPath
      : subject.kind === "folder"
        ? subject.sourcePath.split("/").slice(0, -1).join("/")
        : ""
  ));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (folderPaths !== undefined) {
      setLoadedPaths(folderPaths);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let active = true;
    setLoading(true);
    api.docs.tree(false)
      .then((nodes) => {
        if (!active) return;
        setLoadedPaths(nodes.filter((node) => node.type === "folder").map((node) => node.path));
        setLoadError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [folderPaths]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, saving]);

  const allFolders = useMemo(() => collectMoveFolderPaths(loadedPaths), [loadedPaths]);
  const existingFolderSet = useMemo(() => new Set(allFolders), [allFolders]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredFolders = useMemo(() => allFolders.filter((path) => (
    !normalizedSearch || path.toLocaleLowerCase().includes(normalizedSearch)
  )), [allFolders, normalizedSearch]);
  const visibleFolders = filteredFolders.slice(0, MAX_VISIBLE_FOLDERS);

  const resolved = useMemo(() => {
    try {
      return { targetPath: resolveMoveTarget(subject, destination), error: null };
    } catch (reason) {
      return {
        targetPath: "",
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }, [destination, subject]);

  const sourcePath = subject.kind === "document"
    ? subject.currentPath
    : subject.kind === "documents"
      ? `${subject.count} 篇文档`
      : subject.sourcePath;
  const willMerge = subject.kind === "folder"
    && !!resolved.targetPath
    && existingFolderSet.has(resolved.targetPath);

  const candidateState = (path: string) => {
    try {
      resolveMoveTarget(subject, path);
      return { disabled: false, reason: "" };
    } catch {
      return {
        disabled: true,
        reason: subject.kind === "document" && path === subject.currentPath
          ? "当前位置"
          : "不可用",
      };
    }
  };

  const submit = async () => {
    if (!resolved.targetPath || resolved.error || saving) {
      setError(resolved.error ?? "请选择目标目录");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onMove(resolved.targetPath);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };

  const dialog = (
    <div className="dialog-overlay move-to-overlay" onMouseDown={() => { if (!saving) onClose(); }}>
      <div
        className="dialog move-to-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-to-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h3 id="move-to-title">移动到</h3>
          <button className="btn-icon dialog-close" onClick={onClose} disabled={saving} aria-label="关闭">✕</button>
        </div>

        <div className="dialog-body move-to-body">
          <div className="move-to-subject">
            <span>{subject.kind === "folder" ? "目录" : "文档"}</span>
            <strong>{subject.kind === "document"
              ? subject.title
              : subject.kind === "documents"
                ? `已选择 ${subject.count} 篇`
                : subject.sourcePath.split("/").pop()}</strong>
            {subject.kind === "folder" && subject.documentCount !== undefined && (
              <small>{subject.documentCount} 篇文档</small>
            )}
          </div>

          <label className="dialog-field move-to-search-field">
            <span className="dialog-label">搜索已有目录</span>
            <input
              ref={searchRef}
              className="dialog-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="输入目录名称或路径…"
            />
          </label>

          <div className="move-to-folder-list" role="listbox" aria-label="已有目录">
            {subject.kind === "folder" && !normalizedSearch && (() => {
              const rootState = candidateState("");
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={destination === ""}
                  className={`move-to-folder-option ${destination === "" ? "selected" : ""}`}
                  disabled={rootState.disabled}
                  onClick={() => { setDestination(""); setError(null); }}
                >
                  <span className="move-to-folder-icon">⌂</span>
                  <span className="move-to-folder-path">文档根目录</span>
                  {rootState.reason && <span className="move-to-folder-state">{rootState.reason}</span>}
                </button>
              );
            })()}
            {loading ? (
              <div className="move-to-list-message">正在加载目录…</div>
            ) : loadError ? (
              <div className="move-to-list-message error">目录加载失败：{loadError}</div>
            ) : visibleFolders.length === 0 ? (
              <div className="move-to-list-message">没有匹配的目录</div>
            ) : visibleFolders.map((path) => {
              const state = candidateState(path);
              const depth = path.split("/").length - 1;
              return (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={destination === path}
                  className={`move-to-folder-option ${destination === path ? "selected" : ""}`}
                  disabled={state.disabled}
                  onClick={() => { setDestination(path); setError(null); }}
                >
                  <span className="move-to-folder-indent" style={{ width: `${depth * 12}px` }} />
                  <span className="move-to-folder-icon">📁</span>
                  <span className="move-to-folder-path">{path}</span>
                  {state.reason && <span className="move-to-folder-state">{state.reason}</span>}
                </button>
              );
            })}
          </div>
          {filteredFolders.length > MAX_VISIBLE_FOLDERS && (
            <div className="move-to-limit-hint">仅显示前 {MAX_VISIBLE_FOLDERS} 项，请继续输入以缩小范围。</div>
          )}

          <label className="dialog-field move-to-path-field">
            <span className="dialog-label">
              {destinationLabel(subject)}
              <span className="dialog-hint">（可直接输入新目录）</span>
            </span>
            <input
              className="dialog-input move-to-path-input"
              value={destination}
              onChange={(event) => { setDestination(event.target.value); setError(null); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={subject.kind === "folder" ? "留空表示文档根目录" : "例如 archives/old"}
              aria-invalid={!!(error || resolved.error)}
            />
          </label>
          {!error && resolved.error && (
            <div className="move-to-validation" role="status">{resolved.error}</div>
          )}

          <div className="move-to-preview">
            <span>预览</span>
            <code>{sourcePath}</code>
            <span>→</span>
            <code>{resolved.targetPath || "请选择目标"}</code>
          </div>
          {willMerge && <div className="move-to-warning">目标目录已存在，移动后将合并目录内容。</div>}
          {error && <div className="move-to-error" role="alert">移动失败：{error}</div>}
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>取消</button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!resolved.targetPath || !!resolved.error || saving}
          >
            {saving ? "移动中…" : "移动"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export default MoveToDialog;
