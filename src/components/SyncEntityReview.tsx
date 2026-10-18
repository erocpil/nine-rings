import { syncStage } from "../lib/sync/operation-progress";
import { SyncMigrationActions } from "./SyncMigrationActions";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  previewSyncDestinationFromGitHub,
  assertEntityReviewHeadFromGitHub,
  type SyncConfig,
} from "../lib/sync/github";
import type { EntityReview } from "../lib/sync/entity-review";
import type { BootstrapReview } from "../lib/sync/bootstrap-review";
import type { EntityChoice, EntityPlanRow } from "../lib/sync/entity-plan";
import { parseSyncJson } from "../lib/sync/strict-json";
import { isEncrypted } from "../lib/document-crypto";
import { DocumentComparison } from "./DocumentComparison";
import type { SyncRemoteDocumentPreview } from "../lib/sync/backup-merge";

const settingsNames: Record<string, string> = { frontend: "界面与阅读偏好", "app-config": "应用配置" };
const difference: Record<EntityPlanRow["difference"], string> = {
  equal: "相同",
  "local-change": "本机修改",
  "remote-change": "远端修改",
  conflict: "双方修改",
  unbased: "尚无接受基线",
  "pending-delete": "缺席，等待独立处理",
};
type Entry = Record<string, unknown>;
function notes(source?: string): Map<string, Entry> {
  if (!source) return new Map();
  const payload = parseSyncJson(source) as { notes: Entry[] };
  return new Map(payload.notes.map((note) => [String(note.id), note]));
}
function preview(value: Entry, revision: string): SyncRemoteDocumentPreview {
  const { content, ...properties } = value;
  return {
    id: String(value.id),
    title: String(value.title ?? "无标题"),
    kind: "document",
    storagePath: String(value.storagePath ?? value.storage_path ?? ""),
    date: String(value.date ?? ""),
    updatedAt: String(value.updated_at ?? ""),
    encrypted: isEncrypted(content),
    content,
    contentPreview: "",
    revision,
    properties: JSON.stringify(properties, null, 2),
  };
}
/** Choice UI is deliberately separated from legacy Push/Pull and accepted receipts. */
export function SyncEntityReview({
  config,
  disabled,
  onBeforeSnapshot,
  onOperationChange,
  onPullDone,
}: {
  config: SyncConfig;
  disabled: boolean;
  onBeforeSnapshot?: () => Promise<void>;
  onOperationChange: (busy: boolean) => void;
  onPullDone?: () => void | Promise<void>;
}) {
  const [review, setReview] = useState<EntityReview | null>(null),
    [choices, setChoices] = useState<EntityChoice[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(0),
    [showEqual, setShowEqual] = useState(false),
    [selected, setSelected] = useState("");
  const request = useRef(0);
  const [bootstrap, setBootstrap] = useState<BootstrapReview | null>(null);
  const operation = useRef(onOperationChange);
  operation.current = onOperationChange;
  useEffect(() => {
    request.current++;
    setReview(null);
    setBootstrap(null);
    setChoices([]);
    setMessage("");
    setBusy(false);
    operation.current(false);
    const sequence = request;
    const notify = operation;
    return () => {
      sequence.current++;
      notify.current(false);
    };
  }, [config.owner, config.repo, config.path, config.token]);
  const left = useMemo(() => notes(review?.localSource), [review?.localSource]);
  const right = useMemo(
    () => notes(review?.remoteSource),
    [review?.remoteSource],
  );
  const rows =
    review?.rows.filter((row) => showEqual || row.difference !== "equal") ?? [];
  const start = page * 20,
    visible = rows.slice(start, start + 20);
  const current = review?.rows.find((row) => row.key === selected);
  const choose = (row: EntityPlanRow, action: string) => {
    setChoices((values) => [
      ...values.filter((value) => value.key !== row.key),
      ...(action
        ? [
            {
              key: row.key,
              localHash: row.localHash,
              remoteHash: row.remoteHash,
              action: action as EntityChoice["action"],
            },
          ]
        : []),
    ]);
    setMessage("");
    setSelected(row.key);
  };
  const cancel = () => {
    request.current++;
    setBusy(false);
    operation.current(false);
    setMessage("已取消此次检查，未修改文档或接受基线。");
  };
  const run = async (save: boolean) => {
    const id = ++request.current;
    setBusy(true);
    operation.current(true);
    setMessage("");
    try {
      syncStage("保存当前编辑与等待保存屏障");
      await onBeforeSnapshot?.();
      if (id !== request.current) return;
      syncStage("导出本机快照并准备实体比较");
      const source = await api.export.data();
      if (id !== request.current) return;
      if (save && review) {
        syncStage("重验选择、本机修订与远端提交");
        await assertEntityReviewHeadFromGitHub(
          config,
          review.space,
          review.expectedHead,
        );
        if (id !== request.current) return;
        const { persistEntityReviewChoices } =
          await import("../lib/sync/entity-review");
        const result = await persistEntityReviewChoices(
          review,
          choices,
          source,
          () => {
            if (id !== request.current) throw Error("检查已取消");
          },
        );
        if (id !== request.current) return;
        setReview({ ...review, draftRevision: result.draft.revision });
        const conflicts = result.candidate.rows.filter(
          (row) =>
            row.decision === "conflict" || row.decision === "pending-delete",
        ).length;
        setMessage(
          `选择草稿已保存；${conflicts} 项仍待处理。未上传、应用或确认接受。`,
        );
      } else {
        const result = await previewSyncDestinationFromGitHub(config, source, () => {
          if (id !== request.current) throw Error("检查已取消");
        });
        if (id !== request.current) return;
        if ("kind" in result) {
          setBootstrap(result);
          setReview(null);
          setChoices([]);
          setMessage(
            `空备份空间预检完成：本机 ${result.entityCount} 项实体。首次发布前请保存并核验备份。`,
          );
          return;
        }
        setBootstrap(null);
        setReview(result);
        setChoices(result.choices);
        setPage(0);
        setSelected("");
        const timings = ` 历史与快照预检 ${Math.ceil(result.timings.inspectionMs / 1000)} 秒，候选比较 ${Math.ceil(result.timings.comparisonMs / 1000)} 秒。`;
        setMessage((
          result.expiredDraft
            ? "之前的选择已过期，请按当前快照重新选择。"
            : result.choices.length
              ? "已恢复匹配当前快照的选择草稿。"
              : "预检完成，尚未选择的差异保留远端候选，本机不变。"
        ) + timings);
      }
    } catch (error) {
      if (id === request.current)
        setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === request.current) {
        setBusy(false);
        operation.current(false);
      }
    }
  };
  return (
    <section className="sync-entity-review" aria-label="增量备份候选审查">
      <h4>增量备份候选审查</h4>
      <p>
        先检查差异并保存选择草稿。迁移、发布和应用须在下方明确确认，且受版本能力门禁限制。
      </p>
      <div className="settings-row">
        <button
          type="button"
          className="settings-btn"
          disabled={disabled || busy}
          onClick={() => void run(false)}
        >
          {review ? "重新预检实体" : "预检实体差异"}
        </button>
        {review && (
          <button
            type="button"
            className="settings-btn"
            disabled={disabled || busy}
            onClick={() => void run(true)}
          >
            校验并保存选择
          </button>
        )}
        {busy && (
          <button type="button" className="settings-btn" onClick={cancel}>
            取消检查
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
      {bootstrap && (
        <SyncMigrationActions
          key={bootstrap.binding}
          config={config}
          review={bootstrap}
          choices={[]}
          disabled={disabled || busy}
          onBeforeSnapshot={onBeforeSnapshot}
          onOperationChange={onOperationChange}
          onAccepted={(result) => {
            setBootstrap(null);
            setMessage(`${result} 请重新预检最新差异。`);
          }}
        />
      )}
      {review && (
        <>
          <SyncMigrationActions
            key={review.binding}
            config={config}
            review={review}
            choices={choices}
            disabled={disabled || busy}
            onBeforeSnapshot={onBeforeSnapshot}
            onOperationChange={onOperationChange}
            onPullDone={onPullDone}
            onAccepted={(resultMessage) => {
              setReview(null);
              setChoices([]);
              setSelected("");
              setMessage(`${resultMessage} 请重新预检最新差异。`);
            }}
          />
          <p>
            固定快照 {review.snapshotId} · 已接受基线 {review.baselines.length}{" "}
            项 · 共 {review.rows.length} 项
          </p>
          <label>
            <input
              type="checkbox"
              checked={showEqual}
              onChange={(event) => {
                setShowEqual(event.target.checked);
                setPage(0);
              }}
            />
            显示相同项
          </label>
          <div className="sync-entity-table-scroll">
            <table className="sync-entity-table">
              <thead>
                <tr>
                  <th>实体</th>
                  <th>差异</th>
                  <th>选择</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelected(row.key)}
                      >
                        {String(
                          (row.kind === "settings" ? settingsNames[row.id] : row.kind === "note"
                            ? (left.get(row.id) ?? right.get(row.id))?.title
                            : null) ?? row.id,
                        )}
                      </button>
                      <small>
                        {row.kind === "settings" ? "设置（整体同步）" : `${row.kind} · ${row.id}`}
                      </small>
                    </td>
                    <td>{difference[row.difference]}</td>
                    <td>
                      <select
                        aria-label={`选择 ${row.id}`}
                        disabled={busy || disabled}
                        value={
                          choices.find((value) => value.key === row.key)
                            ?.action ?? ""
                        }
                        onChange={(event) => choose(row, event.target.value)}
                      >
                        <option value="">尚未选择</option>
                        <option
                          value="local"
                          disabled={
                            !row.localHash ||
                            row.difference === "pending-delete"
                          }
                        >
                          本机版本
                        </option>
                        <option
                          value="remote"
                          disabled={
                            !row.remoteHash ||
                            row.difference === "pending-delete"
                          }
                        >
                          远端版本
                        </option>
                        <option value="ignore">忽略此次差异</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p>当前筛选下没有差异。</p>}
          <div className="settings-row">
            <button
              className="settings-btn"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>
              {rows.length ? start + 1 : 0}–{Math.min(start + 20, rows.length)}{" "}
              / {rows.length}
            </span>
            <button
              className="settings-btn"
              disabled={start + 20 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
          {current && (
            <div className="sync-entity-detail">
              <h4>比较 {current.kind === "settings" ? settingsNames[current.id] ?? current.id : current.id}</h4>
              {current.kind === "settings" && <p>此项是一组设置，不是文档。选择远端会应用整组设置；选择忽略可保留本机偏好。</p>}
              <p>
                本机 {current.localHash?.slice(0, 12) ?? "缺席"} · 远端{" "}
                {current.remoteHash?.slice(0, 12) ?? "缺席"}
              </p>
              {current.kind === "note" &&
              left.has(current.id) &&
              right.has(current.id) ? (
                <DocumentComparison
                  key={current.key}
                  left={preview(left.get(current.id)!, current.localHash!)}
                  right={preview(right.get(current.id)!, current.remoteHash!)}
                  leftLabel="本机"
                  rightLabel="远端"
                />
              ) : (
                <p>
                  此项按完整实体选择；缺席不表示删除，保护与设置关系会在候选校验时统一检查。
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
