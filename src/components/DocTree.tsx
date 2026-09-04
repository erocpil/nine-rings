import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { PathNode, Note } from "../types/models";
import { api } from "../lib/api";
import { withTimeout } from "../lib/async";
import { getOtherFolderPaths, getVisibleDocumentTreeNodes } from "../lib/doc-tree-collapse";
import MoveToDialog from "./MoveToDialog";
import {
  getDocumentFolderPath,
  type MoveToSubject,
} from "../lib/move-to";

interface DocTreeProps {
  onSelect: (note: Note) => void;
  onFolderSelect?: (path: string) => void;
  selectedId: string | null;
  selectedTitle?: string;
  selectedFolderPath?: string | null;
  showDaily?: boolean;
  onCreate: () => void;
  refreshKey?: number;
  onRename?: (id: string, title: string) => void;
  onDelete?: (id: string) => void;
  onToggleReadonly?: (id: string, readonly: boolean) => Promise<void> | void;
  onMoveDocument?: (id: string, targetPath: string) => Promise<void>;
  onBatchMoveDocuments?: (ids: string[], targetPath: string) => Promise<void>;
  onMoveFolder?: (sourcePath: string, targetPath: string) => Promise<void>;
  onBatchDelete?: (ids: string[], folderPath: string) => void;
  onBatchSetReadonly?: (ids: string[], readonly: boolean) => Promise<void> | void;
  propertiesAutoShow?: boolean;
  onTogglePropertiesAuto?: () => void;
  disabled?: boolean;
  toolbarHost?: HTMLElement | null;
  collapsed: Set<string>;
  setCollapsed: Dispatch<SetStateAction<Set<string>>>;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

const DOC_TYPE_ICONS: Record<string, string> = {
  explanation: "📖",
  "how-to": "🔧",
  reference: "📋",
  tutorial: "🎓",
};

const STATE_ICONS: Record<string, string> = {
  projects: "📁",
  areas: "🌐",
  references: "📚",
  ideas: "💡",
  archives: "📦",
  daily: "📅",
};

const DOC_TREE_SCROLL_KEY = "nr:docTreeScrollTop";

interface ContextMenuState {
  x: number;
  y: number;
  type: 'document' | 'folder';
  noteId?: string;
  path: string;
  title: string;
}

interface TreeLongPressState {
  pointerId: number;
  startX: number;
  startY: number;
  timer: number;
  triggered: boolean;
  node: PathNode;
  target: HTMLElement;
}

const TREE_LONG_PRESS_MS = 520;
const TREE_LONG_PRESS_MOVE_TOLERANCE = 12;

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
  const submittedRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submittedRef.current = true;
      onSubmit(value.trim());
    }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  return (
    <input
      ref={ref}
      className="doc-tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => { if (!submittedRef.current) onSubmit(value.trim()); }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function DocTree({
  onSelect, onFolderSelect, selectedId, selectedTitle, selectedFolderPath, showDaily = false, onCreate, refreshKey,
  onRename, onDelete, onToggleReadonly,
  onMoveDocument, onBatchMoveDocuments, onMoveFolder,
  onBatchDelete, onBatchSetReadonly,
  propertiesAutoShow, onTogglePropertiesAuto,
  disabled, toolbarHost, collapsed, setCollapsed,
}: DocTreeProps) {
  const [tree, setTree] = useState<PathNode[]>([]);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const treeLongPressRef = useRef<TreeLongPressState | null>(null);
  const suppressTreeClickUntilRef = useRef(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);  // 正在重命名的 folder path
  const [moveSubject, setMoveSubject] = useState<MoveToSubject | null>(null);

  // ── 批量选择 ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

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

  const loadTree = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    withTimeout(api.docs.tree(showDaily), 15000, "加载文档树").then((nodes) => {
      const visibleNodes = getVisibleDocumentTreeNodes(nodes, showDaily);
      // 大型备份若沿用“全部展开”，React 会在一次提交中创建数千个 DOM 节点。
      // 首次加载时折叠顶层目录；用户展开某个目录时再渲染其内容。
      if (visibleNodes.length > 1000) {
        setCollapsed((previous) => {
          if (previous.size > 0) return previous;
          return new Set(
            visibleNodes
              .filter((node) => node.type === "folder" && !node.path.includes("/"))
              .map((node) => node.path),
          );
        });
      }
      setTree(visibleNodes);
    }).catch((error) => {
      console.error("[DocTree] 加载失败:", error);
      setLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => setLoading(false));
  }, [setCollapsed, showDaily]);

  useEffect(() => {
    loadTree();
  }, [refreshKey, loadTree]);

  // 标题输入先更新界面、随后由自动保存持久化。不要在每次按键时重新查询
  // 数据库，否则会在防抖保存完成前把旧标题重新显示到文档树中。
  useEffect(() => {
    if (!selectedId || selectedTitle === undefined) return;
    setTree((previous) => previous.map((node) =>
      node.noteId === selectedId && node.name !== selectedTitle
        ? { ...node, name: selectedTitle }
        : node
    ));
  }, [selectedId, selectedTitle]);

  useLayoutEffect(() => {
    if (loading || !treeScrollRef.current) return;
    const saved = Number(localStorage.getItem(DOC_TREE_SCROLL_KEY));
    if (Number.isFinite(saved) && saved >= 0) treeScrollRef.current.scrollTop = saved;
  }, [loading]);

  useLayoutEffect(() => {
    const scrollRoot = treeScrollRef.current;
    if (loading || !selectedId || !scrollRoot) return;
    const selected = scrollRoot.querySelector<HTMLElement>(".doc-tree-selected");
    // 祖先目录尚未展开时节点还不在 DOM；collapsed 更新后本 effect 会重试。
    if (!selected) return;
    const rootRect = scrollRoot.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const margin = 4;
    const visibleTop = rootRect.top + margin;
    const visibleBottom = rootRect.bottom - margin;
    let delta = 0;
    if (selectedRect.top < visibleTop) delta = selectedRect.top - visibleTop;
    else if (selectedRect.bottom > visibleBottom) delta = selectedRect.bottom - visibleBottom;
    if (delta !== 0) {
      scrollRoot.scrollTop = Math.max(0, scrollRoot.scrollTop + delta);
      localStorage.setItem(DOC_TREE_SCROLL_KEY, String(scrollRoot.scrollTop));
    }
  }, [collapsed, loading, selectedId, tree]);

  useEffect(() => {
    if (contextMenu) {
      const close = () => setContextMenu(null);
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [contextMenu]);

  useEffect(() => () => {
    if (treeLongPressRef.current) window.clearTimeout(treeLongPressRef.current.timer);
    treeLongPressRef.current = null;
  }, []);

  // 菜单渲染后再按真实尺寸限制到视觉视口内。右键点接近窗口底部或
  // 右侧时向上/向左避让；菜单高于小窗口时由 CSS 在内部滚动。
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
    const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
    const margin = 8;
    const maxX = Math.max(viewportLeft + margin, viewportRight - rect.width - margin);
    const maxY = Math.max(viewportTop + margin, viewportBottom - rect.height - margin);
    const x = Math.max(viewportLeft + margin, Math.min(contextMenu.x, maxX));
    const y = Math.max(viewportTop + margin, Math.min(contextMenu.y, maxY));
    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((current) => current ? { ...current, x, y } : current);
    }
  }, [contextMenu]);

  const toggleCollapse = (path: string) => {
    setContextMenu(null);
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
    setContextMenu(null);
    const allFolderPaths = tree
      .filter((n) => n.type === "folder")
      .map((n) => n.path);
    setCollapsed(new Set(allFolderPaths));
  };

  const collapseOthers = () => {
    setContextMenu(null);
    setCollapsed(new Set(getOtherFolderPaths(tree, selectedId, selectedFolderPath ?? null)));
  };

  const openContextMenu = (node: PathNode, x: number, y: number) => {
    setContextMenu({
      x,
      y,
      type: node.type,
      noteId: node.noteId,
      path: node.path,
      title: node.name,
    });
  };

  const handleContextMenu = (e: React.MouseEvent, node: PathNode) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(node, e.clientX, e.clientY);
  };

  const clearTreeLongPress = () => {
    if (treeLongPressRef.current) window.clearTimeout(treeLongPressRef.current.timer);
    treeLongPressRef.current = null;
  };

  const handleTreePointerDown = (event: React.PointerEvent<HTMLDivElement>, node: PathNode) => {
    if (event.pointerType === "mouse" || event.button !== 0 || selectMode) return;
    if ((event.target as HTMLElement).closest("button, input")) return;
    clearTreeLongPress();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const gesture: TreeLongPressState = {
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timer: 0,
      triggered: false,
      node,
      target,
    };
    gesture.timer = window.setTimeout(() => {
      if (treeLongPressRef.current !== gesture) return;
      gesture.triggered = true;
      suppressTreeClickUntilRef.current = Date.now() + 700;
      window.getSelection()?.removeAllRanges();
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Synthetic events and older WebViews may not expose an active pointer to capture.
      }
      openContextMenu(node, gesture.startX, gesture.startY);
    }, TREE_LONG_PRESS_MS);
    treeLongPressRef.current = gesture;
  };

  const handleTreePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = treeLongPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.triggered) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > TREE_LONG_PRESS_MOVE_TOLERANCE) {
      clearTreeLongPress();
    }
  };

  const handleTreePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = treeLongPressRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.triggered) {
      event.preventDefault();
      event.stopPropagation();
    }
    clearTreeLongPress();
  };

  const suppressTreeClickAfterLongPress = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() >= suppressTreeClickUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
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

  // ── 文件夹重命名 ──
  const handleFolderRenameStart = (folderPath: string) => {
    setContextMenu(null);
    setRenamingFolder(folderPath);
  };

  const handleMoveDocument = (noteId: string, title: string, nodePath: string) => {
    setContextMenu(null);
    if (disabled || !onMoveDocument || nodePath.startsWith("daily/")) return;
    setMoveSubject({
      kind: "document",
      noteId,
      title,
      currentPath: getDocumentFolderPath(nodePath, noteId),
    });
  };

  const handleMoveFolder = (sourcePath: string) => {
    setContextMenu(null);
    if (disabled || !onMoveFolder || sourcePath === "daily" || sourcePath.startsWith("daily/")) return;
    const folder = tree.find((node) => node.type === "folder" && node.path === sourcePath);
    setMoveSubject({
      kind: "folder",
      sourcePath,
      documentCount: folder?.count,
    });
  };

  const submitFolderRename = async (folderPath: string, newName: string) => {
    if (disabled) return;
    if (!newName || newName === folderPath.split("/").pop()) {
      setRenamingFolder(null);
      return;
    }
    // 构造新路径：父路径 + "/" + 新名称
    const parts = folderPath.split("/");
    const newPath = parts.length === 1
      ? newName
      : parts.slice(0, -1).join("/") + "/" + newName;
    try {
      await api.docs.renameFolder(folderPath, newPath);
    } catch (e) {
      console.error("renameFolder failed:", e);
      alert(`重命名失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setRenamingFolder(null);
    // 重新加载树
    api.docs.tree(showDaily).then(setTree);
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
    const node = tree.find((item) => item.noteId === noteId);
    if (!node || !onToggleReadonly) return;
    const nextReadonly = !node.readonly;

    // 先更新图标，再持久化；失败时回滚，避免界面显示与数据库不一致。
    setTree((prev) =>
      prev.map((item) =>
        item.noteId === noteId ? { ...item, readonly: nextReadonly } : item
      )
    );
    try {
      await onToggleReadonly(noteId, nextReadonly);
    } catch (error) {
      setTree((prev) =>
        prev.map((item) =>
          item.noteId === noteId ? { ...item, readonly: node.readonly } : item
        )
      );
      console.error("toggle readonly failed:", error);
    }
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
      onBatchDelete?.(ids, folderPath);
    }
  };

  const handleFolderToggleReadonly = async (folderPath: string) => {
    setContextMenu(null);
    if (disabled) return;
    const ids = getDocIdsUnderPath(folderPath);
    if (ids.length === 0) return;
    // 检查当前大多数文档是否只读
    const readonlyCount = tree
      .filter((n) => ids.includes(n.noteId ?? '') && n.readonly)
      .length;
    const setTo = readonlyCount < ids.length / 2;
    // 本地更新 tree
    const idSet = new Set(ids);
    setTree((prev) =>
      prev.map((n) =>
        n.noteId && idSet.has(n.noteId) ? { ...n, readonly: setTo } : n
      )
    );
    try {
      await onBatchSetReadonly?.(ids, setTo);
    } catch (error) {
      // 批量更新可能部分成功，重新读取数据库状态比猜测回滚结果更可靠。
      console.error("batch toggle readonly failed:", error);
      loadTree();
    }
  };

  const handleSelectedReadonly = async (readonly: boolean) => {
    if (disabled || batchBusy || selectedIds.size === 0 || !onBatchSetReadonly) return;
    const ids = [...selectedIds];
    const idSet = new Set(ids);
    setBatchBusy(true);
    setTree((previous) => previous.map((node) => (
      node.noteId && idSet.has(node.noteId) ? { ...node, readonly } : node
    )));
    try {
      await onBatchSetReadonly(ids, readonly);
      clearSelection();
    } catch (error) {
      console.error("batch set readonly failed:", error);
      loadTree();
    } finally {
      setBatchBusy(false);
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
            onPointerDown={(event) => handleTreePointerDown(event, node)}
            onPointerMove={handleTreePointerMove}
            onPointerUp={handleTreePointerEnd}
            onPointerCancel={handleTreePointerEnd}
            onClickCapture={suppressTreeClickAfterLongPress}
          >
            {hasChildren ? (
              <button
                type="button"
                className="doc-tree-toggle"
                aria-label={`${isCollapsed ? "展开" : "折叠"}目录 ${node.name}`}
                aria-expanded={!isCollapsed}
                onClick={(e) => { e.stopPropagation(); toggleCollapse(node.path); }}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            ) : (
              <span className="doc-tree-toggle" aria-hidden="true" />
            )}
            <span className="doc-tree-icon">
              {STATE_ICONS[node.path.split("/")[0]] ?? "📂"}
            </span>
            {renamingFolder === node.path ? (
              <InlineRename
                initialValue={node.name}
                onSubmit={(value) => submitFolderRename(node.path, value)}
                onCancel={() => setRenamingFolder(null)}
              />
            ) : (
              <>
                <span
                  className="doc-tree-name"
                  title={node.name}
                  onClick={() => onFolderSelect?.(node.path)}
                >
                  {node.name}
                </span>
                <span className="doc-tree-count">{node.count ?? 0}</span>
              </>
            )}
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
        onPointerDown={(event) => handleTreePointerDown(event, node)}
        onPointerMove={handleTreePointerMove}
        onPointerUp={handleTreePointerEnd}
        onPointerCancel={handleTreePointerEnd}
        onClickCapture={suppressTreeClickAfterLongPress}
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
        <span className="doc-tree-icon">{node.readonly ? "🔒" : (node.docType && DOC_TYPE_ICONS[node.docType]) || "🧩"}</span>
        {isRenaming && node.noteId ? (
          <InlineRename
            initialValue={node.name}
            onSubmit={(value) => submitRename(node.noteId!, value)}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <span className="doc-tree-name" title={node.name}>{node.name}</span>
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

  if (loadError) {
    return (
      <div className="doc-tree-loading">
        <div>文档加载失败</div>
        <div className="doc-tree-error-detail">{loadError}</div>
        <button className="settings-retry" onClick={loadTree}>重试</button>
      </div>
    );
  }

  const toolbar = (
    <div className="doc-tree-toolbar">
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
          disabled={!selectedId && !selectedFolderPath}
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
                if (disabled || batchBusy || selectedIds.size === 0) return;
                const noteIds = Array.from(selectedIds);
                setMoveSubject({ kind: "documents", noteIds, count: noteIds.length });
              }}
              title="批量移动"
              disabled={disabled || batchBusy || selectedIds.size === 0}
            >
              ↗
            </button>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => {
                if (disabled || batchBusy) return;
                const ids = Array.from(selectedIds);
                if (ids.length > 0 && confirm(`删除选中的 ${ids.length} 篇文档？`)) {
                  onBatchDelete?.(ids, "");
                  clearSelection();
                }
              }}
              title="批量删除"
              disabled={disabled || batchBusy || selectedIds.size === 0}
            >
              🗑
            </button>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => void handleSelectedReadonly(true)}
              title="批量设为只读"
              disabled={disabled || batchBusy || selectedIds.size === 0}
            >
              🔒
            </button>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => void handleSelectedReadonly(false)}
              title="批量取消只读"
              disabled={disabled || batchBusy || selectedIds.size === 0}
            >
              🔓
            </button>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={clearSelection}
              title="取消选择"
              disabled={batchBusy}
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-icon doc-tree-batch-btn"
              onClick={() => selectedId && handleRename(selectedId)}
              title="重命名当前文档"
              disabled={disabled || !selectedId}
            >
              ✎
            </button>
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
  );

  return (
    <>
      {toolbarHost === undefined
        ? <div className="doc-tree-toolbar-inline">{toolbar}</div>
        : toolbarHost
          ? createPortal(toolbar, toolbarHost)
          : null}
      <div
        className="doc-tree"
        ref={treeScrollRef}
        onScroll={(event) => localStorage.setItem(DOC_TREE_SCROLL_KEY, String(event.currentTarget.scrollTop))}
      >
      {roots.length === 0 ? (
        <div className="doc-tree-empty">暂无文档。点击 + 新建。</div>
      ) : (
        sortNodes(roots).map((root) => renderNode(root, 0))
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="doc-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'folder' ? (
            <>
              {contextMenu.path !== "daily" && !contextMenu.path.startsWith("daily/") && (
                <button className="doc-context-item" onClick={() => handleMoveFolder(contextMenu.path)}>
                  移动到…
                </button>
              )}
              <button className="doc-context-item" onClick={() => handleFolderRenameStart(contextMenu.path)}>
                重命名
              </button>
              <button className="doc-context-item" onClick={() => handleFolderDelete(contextMenu.path)}>
                删除目录及其下文档
              </button>
              <button className="doc-context-item" onClick={() => handleFolderToggleReadonly(contextMenu.path)}>
                切换目录下文档只读
              </button>
            </>
          ) : (
            <>
              {!contextMenu.path.startsWith("daily/") && (
                <button className="doc-context-item" onClick={() => handleMoveDocument(contextMenu.noteId!, contextMenu.title, contextMenu.path)}>
                  移动到…
                </button>
              )}
              <button className="doc-context-item" onClick={() => handleRename(contextMenu.noteId!)}>重命名</button>
              <button className="doc-context-item" onClick={() => handleToggleReadonly(contextMenu.noteId!)}>切换只读</button>
              <button className="doc-context-item doc-context-danger" onClick={() => handleDelete(contextMenu.noteId!, contextMenu.title)}>删除</button>
            </>
          )}
        </div>
      )}

      {moveSubject && (
        <MoveToDialog
          subject={moveSubject}
          folderPaths={tree.filter((node) => node.type === "folder").map((node) => node.path)}
          onClose={() => setMoveSubject(null)}
          onMove={async (targetPath) => {
            if (moveSubject.kind === "document") {
              if (!onMoveDocument) throw new Error("文档移动功能不可用");
              await onMoveDocument(moveSubject.noteId, targetPath);
            } else if (moveSubject.kind === "documents") {
              if (!onBatchMoveDocuments) throw new Error("批量移动功能不可用");
              await onBatchMoveDocuments(moveSubject.noteIds, targetPath);
              clearSelection();
            } else {
              if (!onMoveFolder) throw new Error("目录移动功能不可用");
              await onMoveFolder(moveSubject.sourcePath, targetPath);
            }
          }}
        />
      )}

      </div>
    </>
  );
}

export default DocTree;
