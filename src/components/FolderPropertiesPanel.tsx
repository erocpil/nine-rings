import { useConfirmation } from "./ConfirmationDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { DocType, Note, PathNode } from "../types/models";

interface FolderPropertiesPanelProps {
  path: string;
  securityDisabled?: boolean;
  onPathSecurity: (path: string, action: "set" | "remove" | "delete") => Promise<boolean>;
  onFilterByPath?: (path: string, docType?: DocType) => void;
  onCreateDocument: () => void;
  onClose: () => void;
}

interface FolderProtectionStatus {
  protected: boolean;
  protectionRoot: boolean;
}

function FolderPropertiesPanel({
  path,
  securityDisabled,
  onPathSecurity,
  onFilterByPath,
  onCreateDocument,
  onClose,
}: FolderPropertiesPanelProps) {
  const [pathProtection, setPathProtection] = useState<FolderProtectionStatus>({ protected: false, protectionRoot: false });
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [recentlyUpdatedAt, setRecentlyUpdatedAt] = useState<string | null>(null);
  const [typeCounts, setTypeCounts] = useState<Record<DocType, number>>({
    explanation: 0,
    "how-to": 0,
    reference: 0,
    tutorial: 0,
  });
  const [pathLoading, setPathLoading] = useState(false);
  const [pathBusy, setPathBusy] = useState(false);
  const [pathMessage, setPathMessage] = useState("");
  const requestIdRef = useRef(0);
  const { confirm, confirmationDialog } = useConfirmation(true, path);

  const pathParts = useMemo(() => path.split("/").filter(Boolean), [path]);
  const pathName = pathParts[pathParts.length - 1] || path;
  const quickPathFilters = useMemo(() => [
    { label: "全部文档", value: "all" as const, count: documentCount ?? 0 },
    { label: "解释", value: "explanation" as const, count: typeCounts.explanation },
    { label: "指南", value: "how-to" as const, count: typeCounts["how-to"] },
    { label: "参考", value: "reference" as const, count: typeCounts.reference },
    { label: "教程", value: "tutorial" as const, count: typeCounts.tutorial },
  ], [typeCounts, documentCount]);

  const loadFolderData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setPathLoading(true);
    try {
      const [nodes, notes] = await Promise.all([
        api.docs.tree(false),
        api.docs.listByPath(path),
      ]);
      if (requestId !== requestIdRef.current) return;
      const node = nodes.find((item: PathNode) => item.type === "folder" && item.path === path);
      if (node) {
        setPathProtection({
          protected: Boolean(node.protected),
          protectionRoot: Boolean(node.protectionRoot),
        });
        setDocumentCount(node.count ?? null);
      } else {
        setPathProtection({ protected: false, protectionRoot: false });
        setDocumentCount(null);
      }
      setTypeCounts({
        explanation: notes.filter((note: Note) => note.docType === "explanation").length,
        "how-to": notes.filter((note: Note) => note.docType === "how-to").length,
        reference: notes.filter((note: Note) => note.docType === "reference").length,
        tutorial: notes.filter((note: Note) => note.docType === "tutorial").length,
      });
      if (notes.length) {
        const maxUpdatedAt = notes.reduce((max, note) => {
          if (!note.updated_at) return max;
          return max && max.localeCompare(note.updated_at) >= 0 ? max : note.updated_at;
        }, notes[0]?.updated_at ?? "");
        setRecentlyUpdatedAt(maxUpdatedAt || null);
      } else {
        setRecentlyUpdatedAt(null);
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setPathProtection({ protected: false, protectionRoot: false });
      setDocumentCount(null);
      setRecentlyUpdatedAt(null);
      setTypeCounts({
        explanation: 0,
        "how-to": 0,
        reference: 0,
        tutorial: 0,
      });
    } finally {
      if (requestId === requestIdRef.current) setPathLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void loadFolderData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadFolderData]);

  const runPathSecurity = async (action: "set" | "remove" | "delete") => {
    if (pathBusy || securityDisabled) return;
    if ((action === "remove" || action === "delete") && !pathProtection.protectionRoot) {
      setPathMessage("当前路径未设置路径加密，无需该操作");
      return;
    }

    if (action === "remove") {
      const ok = await confirm({
        title: "解除路径加密",
        description: `解除 ${path}/ 的路径密码后，该路径下新建文档不会继续继承加密。`,
        confirmLabel: "解除路径加密",
        danger: true,
      });
      if (!ok) return;
    } else if (action === "delete") {
      const ok = await confirm({
        title: "删除空加密路径",
        description: "仅当此路径下已无文档时可删除加密路径记录。确认继续？",
        confirmLabel: "删除",
        danger: true,
      });
      if (!ok) return;
    } else if (pathProtection.protectionRoot) {
      const ok = await confirm({
        title: "更改路径密码",
        description: "更改路径密码会用新密码重新加密该路径下全部文档。确认继续？",
        confirmLabel: "继续更改",
      });
      if (!ok) return;
    }

    setPathBusy(true);
    setPathMessage("");
    try {
      if (!await onPathSecurity(path, action)) return;
      if (action === "set") {
        setPathMessage(pathProtection.protectionRoot ? "路径密码已更新" : "路径密码设置成功");
      } else if (action === "remove") {
        setPathMessage("路径密码已解除");
      } else {
        setPathMessage("加密路径记录已删除");
      }
      await loadFolderData();
    } catch (error) {
      setPathMessage(`操作失败：${(error as Error).message}`);
    } finally {
      setPathBusy(false);
    }
  };

  return (
    <div className="properties-panel">
      {confirmationDialog}
      <div className="properties-header">
        <span className="properties-title">属性</span>
        <button className="btn-icon properties-close" onClick={onClose} title="关闭属性面板">✕</button>
      </div>

      <div className="properties-body">
        <div className="prop-section">
          <div className="prop-label">路径</div>
          <div className="prop-empty">{path}</div>
          <div className="prop-empty">
            目录名：{pathName}
          </div>
          <button
            type="button"
            className="settings-sm-btn"
            onClick={onCreateDocument}
          >
            新建文档到该路径
          </button>
          <div className="prop-empty">
            子文档数：{pathLoading ? "读取中…" : (documentCount ?? 0)} 篇
          </div>
          <div className="prop-empty">
            最近改动：{pathLoading ? "读取中…" : (recentlyUpdatedAt ? new Date(recentlyUpdatedAt).toLocaleString() : "暂无文档")}
          </div>
          <div className="prop-quick-filter">
            {quickPathFilters.map((item) => (
              <button
                key={item.label}
                type="button"
                className="settings-sm-btn"
                disabled={Boolean(pathLoading || (pathMessage && pathBusy))}
                onClick={() => { onFilterByPath?.(path, item.value === "all" ? undefined : item.value); }}
              >
                {item.label} ({item.count})
              </button>
            ))}
          </div>
        </div>

        <div className="prop-section">
          <div className="prop-label">路径加密</div>
          {pathLoading ? (
            <div className="prop-empty">正在读取路径加密状态…</div>
          ) : (
            <div className="prop-empty">
              {pathProtection.protectionRoot
                ? "当前路径设置了专属密码"
                : pathProtection.protected
                  ? "当前路径继承上级路径密码"
                  : "当前路径未设置专属路径密码"}
            </div>
          )}
          <div className="prop-security-actions">
            <button
              type="button"
              className="settings-sm-btn"
              disabled={Boolean(securityDisabled || pathBusy)}
              onClick={() => { void runPathSecurity("set"); }}
            >
              {pathBusy ? "处理中…" : pathProtection.protectionRoot ? "更改路径密码" : "设置路径密码"}
            </button>
            {pathProtection.protectionRoot && (
              <>
                <button
                  type="button"
                  className="settings-sm-btn"
                  disabled={Boolean(securityDisabled || pathBusy)}
                  onClick={() => { void runPathSecurity("remove"); }}
                >
                  {pathBusy ? "处理中…" : "解除路径加密"}
                </button>
                <button
                  type="button"
                  className="settings-sm-btn"
                  disabled={Boolean(securityDisabled || pathBusy)}
                  onClick={() => { void runPathSecurity("delete"); }}
                >
                  {pathBusy ? "处理中…" : "删除空加密路径"}
                </button>
              </>
            )}
          </div>
          {pathMessage && <div className={`prop-security-message ${pathMessage.startsWith("操作失败") ? "error" : ""}`} role="status">{pathMessage}</div>}
        </div>
      </div>
    </div>
  );
}

export default FolderPropertiesPanel;
