import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { CURRENT_SYNC_CAPABILITIES } from "../lib/sync/protocol-capabilities";
import {
  MINIMUM_SYNC_CLIENT_VERSION,
  supportedSyncParticipantVersion,
} from "../lib/sync/release-capabilities";
import type { SyncConfig } from "../lib/sync/github";
import type { EntityReview } from "../lib/sync/entity-review";
import type { BootstrapReview } from "../lib/sync/bootstrap-review";
import type { EntityChoice } from "../lib/sync/entity-plan";
import type {
  IncrementalAction,
  VerifiedMigrationBackup,
} from "../lib/sync/incremental-actions";
export function SyncMigrationActions({
  config,
  review,
  choices,
  disabled,
  onBeforeSnapshot,
  onOperationChange,
  onPullDone,
  onAccepted,
}: {
  config: SyncConfig;
  review: EntityReview | BootstrapReview;
  choices: EntityChoice[];
  disabled: boolean;
  onBeforeSnapshot?: () => Promise<void>;
  onOperationChange: (busy: boolean) => void;
  onPullDone?: () => void;
  onAccepted: (message: string) => void;
}) {
  const [backup, setBackup] = useState<VerifiedMigrationBackup | null>(null),
    [participants, setParticipants] = useState(false),
    [minimumVersion, setMinimumVersion] = useState(MINIMUM_SYNC_CLIENT_VERSION),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const sequence = generation;
    return () => {
      sequence.current++;
    };
  }, []);
  const bootstrap = "kind" in review;
  const legacy =
    bootstrap ||
    !Object.prototype.hasOwnProperty.call(
      JSON.parse(review.remoteSource),
      "header",
    );
  const c = CURRENT_SYNC_CAPABILITIES,
    readable = c.read >= 1 && c.formats.includes(1) && c.codecs.includes(1),
    writable = readable && c.write >= 1;
  const remoteCount = choices.filter(
    (v) =>
      v.action === "remote" &&
      !bootstrap &&
      review.rows.some((r) => r.key === v.key && r.difference !== "equal"),
  ).length;
  const equalCount = bootstrap
    ? 0
    : review.rows.filter(
        (r) =>
          r.difference === "equal" &&
          !choices.some((v) => v.key === r.key && v.action === "ignore"),
      ).length;
  const run = async (task: (guard: () => void) => Promise<void>) => {
    const id = ++generation.current;
    const guard = () => {
      if (id !== generation.current) throw Error("操作界面已变化，已停止");
    };
    setBusy(true);
    onOperationChange(true);
    setMessage("");
    try {
      if (!onBeforeSnapshot) throw Error("保存屏障不可用，不能继续");
      await task(guard);
    } catch (reason) {
      if (id === generation.current)
        setMessage(
          reason instanceof Error
            ? reason.message
            : "增量操作失败，请检查恢复提示",
        );
    } finally {
      if (id === generation.current) {
        setBusy(false);
        onOperationChange(false);
      }
    }
  };
  const verify = async (file: File) => {
    setBackup(null);
    await run(async (guard) => {
      if (file.size > 64 * 1024 * 1024)
        throw Error("请选择 64 MiB 以内的本地 JSON 备份");
      await onBeforeSnapshot!();
      guard();
      const { validateEntityReview } =
        await import("../lib/sync/entity-review");
      if (bootstrap) {
        const { validateBootstrapReview } =
          await import("../lib/sync/bootstrap-review");
        await validateBootstrapReview(review, await api.export.data());
      } else
        await validateEntityReview(review, choices, await api.export.data());
      guard();
      const { verifyMigrationBackup } =
        await import("../lib/sync/incremental-actions");
      const proof = await verifyMigrationBackup(review, await file.text());
      guard();
      setBackup(proof);
      setMessage("已读取并核验本地备份文件，与本次预检的本机实体一致。");
    });
  };
  const execute = async (action: IncrementalAction) =>
    run(async (guard) => {
      const { executeIncrementalAction } =
        await import("../lib/sync/incremental-actions");
      const result = bootstrap
        ? await (
            await import("../lib/sync/incremental-actions")
          ).executeBootstrapPublication(
            {
              config,
              review,
              ...(backup ? { backup } : {}),
              participants: { confirmed: participants, minimumVersion },
              migrationConfirmed: confirmed,
            },
            { flush: onBeforeSnapshot!, assertActive: guard },
          )
        : await executeIncrementalAction(
            {
              config,
              review,
              choices,
              action,
              ...(backup ? { backup } : {}),
              participants: { confirmed: participants, minimumVersion },
              migrationConfirmed: confirmed,
            },
            { flush: onBeforeSnapshot!, assertActive: guard },
          );
      guard();
      setMessage(result.message);
      if (result.reload) onPullDone?.();
      setBusy(false);
      onOperationChange(false);
      onAccepted(result.message);
    });
  return (
    <fieldset
      className="sync-migration-actions"
      aria-label="增量操作与首次迁移确认"
      disabled={disabled || busy}
    >
      <legend>{legacy ? "首次迁移确认" : "增量操作确认"}</legend>
      {!writable && (
        <p role="status">
          当前版本尚未认证完整增量读写。可以准备并核验备份；正式发布、应用和接受确认由版本能力门禁控制，勾选确认不能绕过。
        </p>
      )}
      <div className="settings-row">
        <button
          type="button"
          className="settings-btn"
          onClick={() =>
            void run(async (guard) => {
              await onBeforeSnapshot!();
              guard();
              const { exportLocalJsonBackup } =
                await import("../lib/local-backup-export");
              const result = await exportLocalJsonBackup();
              guard();
              setMessage(
                result
                  ? "请确认文件已保存，再选择该文件完成核验。"
                  : "已取消导出，未确认备份。",
              );
            })
          }
        >
          导出迁移前本地备份
        </button>
        <label className="settings-btn">
          选择已保存的备份进行核验
          <input
            aria-label="核验迁移备份文件"
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (file)
                void verify(file).finally(() => {
                  input.value = "";
                });
            }}
          />
        </label>
      </div>
      {backup && (
        <p role="status">备份已核验 · SHA-256 {backup.sha256.slice(0, 16)}…</p>
      )}
      <label className="sync-migration-confirm">
        <input
          type="checkbox"
          checked={participants}
          onChange={(event) => setParticipants(event.target.checked)}
        />
        所有会继续 Push/Pull 的设备均使用 {MINIMUM_SYNC_CLIENT_VERSION}{" "}
        及以上支持此协议的 Web/桌面版；不支持此协议的客户端（含
        Flutter）已停用此连接
      </label>
      <label className="settings-row">
        已确认的最低支持版本
        <input
          aria-label="参与设备最低版本"
          placeholder="例如 1.2.3"
          value={minimumVersion}
          onChange={(event) => setMinimumVersion(event.target.value)}
        />
      </label>
      {legacy && (
        <label className="sync-migration-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          确认切换此备份连接，停止旧格式
          Push/Pull；没有实体变化时也明确创建首次迁移检查点
        </label>
      )}
      <div className="settings-row">
        <button
          type="button"
          className="settings-btn"
          disabled={
            !writable ||
            !backup ||
            !participants ||
            !supportedSyncParticipantVersion(minimumVersion) ||
            (legacy && !confirmed)
          }
          onClick={() => void execute("publish")}
        >
          {legacy ? "首次迁移并发布" : "发布所选本机实体"}
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={!readable || legacy || !remoteCount || !onPullDone}
          onClick={() => void execute("pull")}
        >
          应用所选远端实体（{remoteCount}）
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={!readable || legacy || !equalCount}
          onClick={() => void execute("equal")}
        >
          确认相同内容（{equalCount}）
        </button>
      </div>
      <p>
        远端选择只有实际应用成功后才确认；忽略与缺席不表示删除。成功后重新预检，原选择不继续复用。
      </p>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
