import { useCallback, useEffect, useRef, useState } from "react";
import type { PathNode, Note } from "../types/models";
import { api } from "../lib/api";

interface DocTreeProps {
  onSelect: (note: Note) => void;
  onFolderSelect?: (path: string) => void;
  selectedId: string | null;
  onCreate: () => void;
  refreshKey?: number;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onToggleReadonly?: (id: string, readonly: boolean) => void;
  onBatchDelete?: (ids: string[]) => void;
  onBatchSetReadonly?: (ids: string[], readonly: boolean) => void;
  propertiesAutoShow?: boolean;
  onTogglePropertiesAuto?: () => void;
  disabled?: boolean;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

const STATE_ICONS: Record<string, string> = {
  projects: "📁",
  areas: "🎯",
  references: "📚",
  ideas: "💡",
  archives: "📦",
};

interface ContextMenuState {
  x: number;
  y: number;
  type: 'document' | 'folder';
  noteId?: string;
  path: string;
  title: string;
}

// ── InlineRename：自管 state，隔离渲染范围，避免光标跳动 ──

function InlineRename({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(value.trim()); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  return (
    <input
      ref={ref}
      className="doc-tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onSubmit(value.trim())}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function DocTree({
  onSelect, onFolderSelect, selectedId, onCreate, refreshKey,
  onRename, onDelete, onToggleReadonly,
  onBatchDelete, onBatchSetReadonly,
  propertiesAutoShow, onTogglePropertiesAuto,
  disabled,
}: DocTreeProps) {
  const [tree, setTree] = useState<PathNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("nr:docTreeCollapsed");
      return raw ? new Set(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // ── 批量选择 ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelectId = useCallback((noteId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectMode(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    api.docs.tree().then((nodes) => {
      setTree(nodes);
      setLoading(false);
    });
  }, [refreshKey]);

  // 持久化折叠状态
  useEffect(() => {
    localStorage.setItem("nr:docTreeCollapsed", JSON.stringify([...collapsed]));
  }, [collapsed]);

  useEffect(() => {
    if (contextMenu) {
      const close = () => setContextMenu(null);
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [contextMenu]);

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleDocClick = async (node: PathNode) => {
    if (!node.noteId) return;
    if (selectMode) {
      toggleSelectId(node.noteId);
      return;
    }
    const note = await api.notes.get(node.noteId);
    if (note) onSelect(note);
  };

  const collapseAll = () => {
    const allFolderPaths = tree
      .filter((n) => n.type === "folder")
      .map((n) => n.path);
    setCollapsed(new Set(allFolderPaths));
  };

  const collapseOthers = () => {
    // 找到当前选中文档的父目录
    const selectedNode = tree.find((n) => n.noteId === selectedId);
    if (!selectedNode) return;
    const parts = selectedNode.path.split("/");
    if (parts.length <= 1) return;

    // 收集所有祖先路径（而非仅直接父目录）
    // e.g. "projects/nine-rings/docs" → ancestors = {"projects", "projects/nine-rings"}
    const ancestors = new Set<string>();
    for (let i = 1; i < parts.length; i++) {
      ancestors.add(parts.slice(0, i).join("/"));
    }

    const allFolderPaths = tree
      .filter((n) => n.type === "folder" && !ancestors.has(n.path))
      .map((n) => n.path);
    setCollapsed(new Set(allFolderPaths));
  };

  const handleContextMenu = (e: React.MouseEvent, node: PathNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: node.type,
      noteId: node.noteId,
      path: node.path,
      title: node.name,
    });
  };

  const handleRename = (noteId: string) => {
    setContextMenu(null);
    setRenamingId(noteId);
  };

  const submitRename = (noteId: string, title: string) => {
    if (disabled) return;
    if (title && onRename) onRename(noteId, title);
    // 本地更新 tree，立即反映新名称
    setTree((prev) =>
      prev.map((n) =>
        n.noteId === noteId ? { ...n, name: title } : n
      )
    );
    setRenamingId(null);
  };

  const handleDelete = (noteId: string, title: string) => {
    setContextMenu(null);
    if (disabled) return;
    if (confirm(`删除文档「${title}」？\n删除后可从回收站恢复。`)) {
      onDelete?.(noteId);
    }
  };

  const handleToggleReadonly = async (noteId: string) => {
    setContextMenu(null);
    if (disabled) return;
    try {
      const note = await api.notes.get(noteId);
      if (note && onToggleReadonly) {
        onToggleReadonly(noteId, !note.readonly);
        // 本地更新 tree，立即反映图标变化
        setTree((prev) =>
          prev.map((n) =>
            n.noteId === noteId ? { ...n, readonly: !note.readonly } : n
          )
        );
      }
    } catch {}
  };

  // ── 文件夹操作：收集目录下所有文档 ID ──
  const getDocIdsUnderPath = (folderPath: string): string[] => {
    return tree
      .filter((n) => n.type === 'document' && n.noteId && n.path.startsWith(folderPath + "/"))
      .map((n) => n.noteId!);
  };

  const handleFolderDelete = (folderPath: string) => {
    setContextMenu(null);
    if (disabled) return;
    const ids = getDocIdsUnderPath(folderPath);
    if (ids.length === 0) return;
    if (confirm(`删除目录「${folderPath.split("/").pop()}」及其下 ${ids.length} 篇文档？\\n删除后可从回收站恢复。`)) {
      onBatchDelete?.(ids);
    }
  };

  const handleFolderToggleReadonly = (folderPath: string) => {
    setContextMenu(null);
    if (disabled) return;
    const ids = getDocIdsUnderPath(folderPath);
    if (ids.length === 0) return;
    // 检查当前大多数文档是否只读
    const readonlyCount = tree
      .filter((n) => ids.includes(n.noteId ?? '') && n.readonly)
      .length;
    const setTo = readonlyCount < ids.length / 2;
    onBatchSetReadonly?.(ids, setTo);
    // 本地更新 tree
    const idSet = new Set(ids);
    setTree((prev) =>
      prev.map((n) =>
        n.noteId && idSet.has(n.noteId) ? { ...n, readonly: setTo } : n
      )
    );
  };

  // 按路径分组
  const childrenMap = new Map<string, PathNode[]>();
  const roots: PathNode[] = [];
  for (const node of tree) {
    const parts = node.path.split("/");
    if (parts.length === 1) {
      roots.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      if (!childrenMap.has(parentPath)) childrenMap.set(parentPath, []);
      childrenMap.get(parentPath)!.push(node);
    }
  }

  const sortNodes = (nodes: PathNode[]) =>
    [...nodes].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const renderNode = (node: PathNode, depth: number) => {
    const paddingLeft = 6 + depth * 8;  // 缩进 8px/层
    const isCollapsed = collapsed.has(node.path);
    const hasChildren = childrenMap.has(node.path) && childrenMap.get(node.path)!.length > 0;

    if (node.type === "folder") {
      return (
        <div key={node.path}>
          <div
            className="doc-tree-node doc-tree-folder"
            style={{ paddingLeft }}
            onContextMenu={(e) => handleContextMenu(e, node)}
          >
            <span
              className="doc-tree-toggle"
              onClick={(e) => { e.stopPropagation(); toggleCollapse(node.path); }}
            >
              {hasChildren ? (isCollapsed ? "▶" : "▼") : "  "}
            </span>
            <span className="doc-tree-icon">
              {STATE_ICONS[node.path.split("/")[0]] ?? "📂"}
            </span>
            <span
              className="doc-tree-name"
              onClick={() => onFolderSelect?.(node.path)}
            >
              {node.name}
            </span>
            <span className="doc-tree-count">{node.count ?? 0}</span>
          </div>
          {!isCollapsed && hasChildren && (
            <div>
              {sortNodes(childrenMap.get(node.path)!).map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    // document node
    const isSelected = node.noteId === selectedId;
    const isRenaming = node.noteId === renamingId;
    const isChecked = node.noteId ? selectedIds.has(node.noteId) : false;

    return (
      <div
        key={node.path}
        className={`doc-tree-node doc-tree-doc ${isSelected ? "doc-tree-selected" : ""}`}
        style={{ paddingLeft }}
        onClick={() => handleDocClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        {selectMode && node.noteId && (
          <input
            type="checkbox"
            className="doc-tree-checkbox"
            checked={isChecked}
            onChange={() => toggleSelectId(node.noteId!)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span className="doc-tree-toggle" />
        <span className="doc-tree-icon">{node.readonly ? "🔒" : "🧩"}</span>
        {isRenaming && node.noteId ? (
          <InlineRename
            initialValue={node.name}
            onSubmit={(value) => submitRename(node.noteId!, value)}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <span className="doc-tree-name">{node.name}</span>
        )}
        {node.docType && !isRenaming && (
          <span className="doc-tree-type">{DOC_TYPE_LABELS[node.docType] ?? node.docType}</span>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="doc-tree-loading">加载中...</div>;
  }

  return (
    <div className="doc-tree">
      <div className="doc-tree-header">
        <span className="doc-tree-title">文档</span>
        <span className="doc-tree-header-spacer" />
        <button
          className="btn-icon doc-tree-batch-btn"
          onClick={collapseAll}
          title="折叠所有目录"
        >
          📁
        </button>
        <button
          className="btn-icon doc-tree-batch-btn"
          onClick={collapseOthers}
          title="折叠其它目录（保留当前文档所在目录）"
          disabled={!selectedId}
        >
          📂
        </button>
        <button
          className={`btn-icon doc-tree-batch-btn ${propertiesAutoShow ? "" : "doc-tree-btn-off"}`}
          onClick={onTogglePropertiesAuto}
          title={propertiesAutoShow ? "隐藏属性面板" : "显示属性面板"}
        >
          {propertiesAutoShow ? "⊟" : "⊞"}
        </button>
        {selectMode ? (
          <>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => {
                if (disabled) return;
                const ids = Array.from(selectedIds);
                if (ids.length > 0 && confirm(`删除选中的 ${ids.length} 篇文档？`)) {
                  onBatchDelete?.(ids);
                  clearSelection();
                }
              }}
              title="批量删除"
              disabled={disabled || selectedIds.size === 0}
            >
              🗑
            </button>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => {
                if (disabled) return;
                if (selectedIds.size > 0) {
                  onBatchSetReadonly?.(Array.from(selectedIds), true);
                  clearSelection();
                }
              }}
              title="批量设为只读"
              disabled={disabled || selectedIds.size === 0}
            >
              🔒
            </button>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={clearSelection}
              title="取消选择"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => setSelectMode(true)}
              title="批量选择"
            >
              ☐
            </button>
            <button className="btn-icon doc-tree-add" onClick={disabled ? undefined : onCreate} disabled={disabled} title="新建文档">
              +
            </button>
          </>
        )}
      </div>
      {roots.length === 0 ? (
        <div className="doc-tree-empty">暂无文档。点击 + 新建。</div>
      ) : (
        sortNodes(roots).map((root) => renderNode(root, 0))
      )}

      {contextMenu && (
        <div
          className="doc-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'folder' ? (
            <>
              <button className="doc-context-item" onClick={() => handleFolderDelete(contextMenu.path)}>
                删除目录及其下文档
              </button>
              <button className="doc-context-item" onClick={() => handleFolderToggleReadonly(contextMenu.path)}>
                切换目录下文档只读
              </button>
            </>
          ) : (
            <>
              <button className="doc-context-item" onClick={() => handleRename(contextMenu.noteId!)}>重命名</button>
              <button className="doc-context-item" onClick={() => handleToggleReadonly(contextMenu.noteId!)}>切换只读</button>
              <button className="doc-context-item doc-context-danger" onClick={() => handleDelete(contextMenu.noteId!, contextMenu.title)}>删除</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default DocTree;
