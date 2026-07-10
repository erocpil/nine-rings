import { useEffect, useState } from "react";
import type { PathNode, Note } from "../types/models";
import { api } from "../lib/api";

interface DocTreeProps {
  onSelect: (note: Note) => void;
  onFolderSelect?: (path: string) => void;
  selectedId: string | null;
  onCreate: () => void;
  refreshKey?: number;   // 变化时触发刷新
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

function DocTree({ onSelect, onFolderSelect, selectedId, onCreate, refreshKey }: DocTreeProps) {
  const [tree, setTree] = useState<PathNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    api.docs.tree().then((nodes) => {
      setTree(nodes);
      setLoading(false);
    });
  }, [refreshKey]);

  // 按路径分组，构建父子关系
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

  // 根按名称排序：文件夹在前
  const sortNodes = (nodes: PathNode[]) =>
    [...nodes].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

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
    return (
      <div
        key={node.path}
        className={`doc-tree-node doc-tree-doc ${isSelected ? "doc-tree-selected" : ""}`}
        style={{ paddingLeft }}
        onClick={() => handleDocClick(node)}
      >
        <span className="doc-tree-toggle" />
        <span className="doc-tree-icon">📄</span>
        <span className="doc-tree-name">{node.name}</span>
        {node.docType && (
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
    </div>
  );
}

export default DocTree;
