import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import {
  actionResources,
  type RegisteredAction,
} from "../lib/plugin-system/action-resources";
import type { QueryRow } from "../lib/plugin-system/query-resources";
import type { Note } from "../types/models";
import { api } from "../lib/api";

export function PluginQueryResults({
  entry,
  rows,
  onClose,
  onOpen,
}: {
  entry: RegisteredAction;
  rows: readonly QueryRow[];
  onClose: () => void;
  onOpen?: (note: Note) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  useDialogFocus(dialog, true, close, undefined, true);
  if (entry.value.kind !== "query") return null;
  const query = entry.value;
  const open = async (id: string) => {
    if (opening) return;
    setOpening(true);
    setError("");
    try {
      actionResources.assert(entry);
      const note = await api.notes.get(id);
      actionResources.assert(entry);
      if (!note || note.deleted_at) throw Error("文档已不存在，请重新执行查询");
      await onOpen?.(note);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "打开失败");
    } finally {
      setOpening(false);
    }
  };
  const labels = {
    title: "名称",
    path: "路径",
    tags: "标签",
    concepts: "概念",
    docType: "类型",
    createdAt: "创建时间",
    updatedAt: "修改时间",
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="plugin-parameter-dialog plugin-query-results"
      aria-label={`查询结果：${query.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <h2>{query.name}</h2>
        <button ref={close} type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </header>
      <p>
        本次查询快照 · {rows.length} 份文档 · 最多 {query.limit} 份 ·
        不含受保护路径
      </p>
      {error && <p role="alert">{error}</p>}
      {!rows.length ? (
        <p>没有匹配的文档。</p>
      ) : query.view === "table" ? (
        <div className="plugin-query-table">
          <table>
            <thead>
              <tr>
                <th>打开</th>
                {query.columns.map((column) => (
                  <th key={column}>{labels[column]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      disabled={!onOpen || opening}
                      onClick={() => void open(row.id)}
                      aria-label={`打开 ${row.title}`}
                    >
                      ↗
                    </button>
                  </td>
                  {query.columns.map((column) => (
                    <td key={column}>
                      {Array.isArray(row[column])
                        ? (row[column] as readonly string[]).join("、")
                        : row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="btn"
                disabled={!onOpen || opening}
                onClick={() => void open(row.id)}
              >
                {row.title}
              </button>
              <small>{row.path}</small>
            </li>
          ))}
        </ul>
      )}
    </dialog>,
    document.body,
  );
}
