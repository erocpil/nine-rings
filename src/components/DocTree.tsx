import { useEffect, useRef, useState } from "react";
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
}

const DOC_TYPE_LABELS: Record<string, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

const STATE_ICONS: Record<string, string> = {
  projects: "📁",
  areas: "🗂",
  references: "📚",
  ideas: "💡",
  archives: "📦",
};

interface ContextMenuState {
  x: number;
  y: number;
  noteId: string;
  title: string;
}

function DocTree({
  onSelect, onFolderSelect, selectedId, onCreate, refreshKey,
  onRename, onDelete, onToggleReadonly,
}: DocTreeProps) {
  const [tree, setTree] = useState<PathNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    api.docs.tree().then((nodes) => {
      setTree(nodes);
      setLoading(false);
    });
  }, [refreshKey]);

  // 关闭右键菜单（点击外部触发）
  useEffect(() => {
    if (contextMenu) {
      const close = () => setContextMenu(null);
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [contextMenu]);

  // 重命名输入自动聚焦
  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingId]);

  // 折叠展开
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
    const note = await api.notes.get(node.noteId);
    if (note) onSelect(note);
  };

  // 右键菜单处理
  const handleContextMenu = (e: React.MouseEvent, node: PathNode) => {
    if (!node.noteId) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      noteId: node.noteId,
      title: node.name,
    });
  };

  const handleRename = async (noteId: string) => {
    setContextMenu(null);
    setRenamingId(noteId);
    // 从树中找到当前标题
    const node = findNode(tree, noteId);
    setRenameValue(node?.name ?? "");
  };

  const submitRename = async (noteId: string) => {
    const title = renameValue.trim();
    if (title && onRename) {
      onRename(noteId, title);
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const findNode = (nodes: PathNode[], noteId: string): PathNode | undefined => {
    for (const n of nodes) {
      if (n.noteId === noteId) return n;
    }
    return undefined;
  };

  const handleDelete = (noteId: string, title: string) => {
    setContextMenu(null);
    if (confirm(`删除文档「${title}」？\n删除后可从回收站恢复。`)) {
      onDelete?.(noteId);
    }
  };

  const handleToggleReadonly = async (noteId: string) => {
    setContextMenu(null);
    try {
      const note = await api.notes.get(noteId);
      if (note && onToggleReadonly) {
        onToggleReadonly(noteId, !note.readonly);
      }
    } catch {}
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, noteId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRename(noteId);
    }
    if (e.key === "Escape") {
      setRenamingId(null);
      setRenameValue("");
    }
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
    const paddingLeft = 12 + depth * 16;
    const isCollapsed = collapsed.has(node.path);
    const hasChildren = childrenMap.has(node.path);

    if (node.type === "folder") {
      return (
        <div key={node.path}>
          <div
            className="doc-tree-node doc-tree-folder"
            style={{ paddingLeft }}
            onClick={() => { toggleCollapse(node.path); onFolderSelect?.(node.path); }}
          >
            <span className="doc-tree-toggle">{hasChildren ? (isCollapsed ? "▶" : "▼") : "  "}</span>
            <span className="doc-tree-icon">
              {STATE_ICONS[node.path.split("/")[0]] ?? "📂"}
            </span>
            <span className="doc-tree-name">{node.name}</span>
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

    return (
      <div
        key={node.path}
        className={`doc-tree-node doc-tree-doc ${isSelected ? "doc-tree-selected" : ""}`}
        style={{ paddingLeft }}
        onClick={() => handleDocClick(node)}
        onContextMenu={(e) => handleContextMenu(e, node)}
      >
        <span className="doc-tree-toggle" />
        <span className="doc-tree-icon">📄</span>
        {isRenaming && node.noteId ? (
          <input
            ref={renameRef}
            className="doc-tree-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => handleRenameKeyDown(e, node.noteId!)}
            onBlur={() => submitRename(node.noteId!)}
            onClick={(e) => e.stopPropagation()}
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
        <button className="btn-icon doc-tree-add" onClick={onCreate} title="新建文档">
          +
        </button>
      </div>
      {roots.length === 0 ? (
        <div className="doc-tree-empty">暂无文档。点击 + 新建。</div>
      ) : (
        sortNodes(roots).map((root) => renderNode(root, 0))
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="doc-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="doc-context-item"
            onClick={() => handleRename(contextMenu.noteId)}
          >
            重命名
          </button>
          <button
            className="doc-context-item"
            onClick={() => handleToggleReadonly(contextMenu.noteId)}
          >
            切换只读
          </button>
          <button
            className="doc-context-item doc-context-danger"
            onClick={() => handleDelete(contextMenu.noteId, contextMenu.title)}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}

export default DocTree;
