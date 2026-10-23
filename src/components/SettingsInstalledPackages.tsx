import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import {
  installPluginPackage,
  listPluginPackages,
  removePluginPackage,
  setPluginPackageEnabled,
  subscribePluginPackages,
  type InstalledPluginPackage,
} from "../lib/plugin-system/package-store";
import type { ValidatedPluginPackage } from "../lib/plugin-system/package-validation";
import { themeResources } from "../lib/plugin-system/theme-resources";
import { pluginRuntime } from "../lib/plugin-system/runtime";
import {
  saveThemePreference,
  readThemePreference,
} from "../lib/plugin-system/theme-preferences";

function PackageConfirmation({
  candidate,
  previous,
  onClose,
  onInstalled,
}: {
  candidate: ValidatedPluginPackage;
  previous: InstalledPluginPackage | undefined;
  onClose(): void;
  onInstalled(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useDialogFocus(dialog, true, cancel, undefined, true);
  return createPortal(
    <dialog
      ref={dialog}
      className="settings-panel plugin-config-dialog"
      aria-label="审查声明式插件包"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          if (!busy) onClose();
        }
      }}
    >
      <div className="plugin-config-heading">
        <h2>{previous ? "审查插件更新" : "审查插件安装"}</h2>
        <button
          ref={cancel}
          type="button"
          className="settings-btn"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
      </div>
      <div className="plugin-config-body">
        <p>
          <strong>{candidate.name}</strong> · {candidate.id} ·{" "}
          {previous ? `${previous.version} → ` : ""}
          {candidate.version}
        </p>
        <p>{candidate.description || "未提供简介"}</p>
        <p>
          本机文件来源，未验证发布者身份。SHA-256
          只证明内容一致，不证明来源可信。包只含声明式数据，不执行脚本；模板与片段仅在明确调用时写入；宏只执行已审核的宿主命令，可编辑或统计当前文档；查询只读取工作区元数据。安装及更新后默认停用。
        </p>
        {previous && (
          <p>
            更新会撤销旧版资源，选中的配色暂时回退原风格；重新启用后恢复。不会删除文档或用户排版设置。
          </p>
        )}
        <ul className="plugin-review-list">
          {candidate.themes.map((theme) => (
            <li key={theme.id}>
              {theme.name} · {theme.id}
              {theme.typography ? " · 含可选排版建议" : " · 仅配色"}
            </li>
          ))}
          {candidate.statusBar && <li>状态栏展示 · 接管对应内置设置，保留宿主导航与保存失败提示 · {candidate.statusBar.showTotals !== false ? "显示" : "隐藏"}总行数与总块数</li>}
          {candidate.gutters.map(display => <li key={display.target}>{display.target === "blocks" ? "渲染块号" : "源码行号"}展示 · 接管对应内置设置，保留宿主菜单与折叠行为</li>)}
          {candidate.actions.map((entry) => (
            <li key={entry.id}>
              {entry.name} ·{" "}
              {entry.kind === "macro"
                ? entry.writes
                  ? "受限宏 · 编辑当前文档"
                  : "受限宏 · 只读"
                : "元数据查询"}{" "}
              · {entry.id}
            </li>
          ))}
          {candidate.content.map((entry) => (
            <li key={entry.id}>
              {entry.name} · {entry.kind === "template" ? "插入模板" : "片段"} ·{" "}
              {entry.id}
              {entry.trigger ? ` · ${entry.trigger}` : ""}
            </li>
          ))}
        </ul>
        <details>
          <summary>核验指纹与资源差异</summary>
          <p className="plugin-package-digest">SHA-256：{candidate.digest}</p>
          <ul className="plugin-review-list">
            {Object.keys(candidate.files)
              .sort()
              .map((path) => (
                <li key={path}>
                  {path} ·{" "}
                  {!previous
                    ? "新增"
                    : previous.files[path] === candidate.files[path]
                      ? "未变"
                      : path in previous.files
                        ? "修改"
                        : "新增"}
                </li>
              ))}
            {Object.keys(previous?.files ?? {})
              .filter((path) => !(path in candidate.files))
              .map((path) => (
                <li key={path}>{path} · 移除</li>
              ))}
          </ul>
        </details>
        <button
          type="button"
          className={`plugin-review-consent ${consent ? "confirmed" : ""}`}
          aria-pressed={consent}
          onClick={() => setConsent((value) => !value)}
        >
          <span aria-hidden="true">{consent ? "✓" : "○"}</span>
          {consent
            ? "已确认检查来源、资源与更新差异（点击取消）"
            : "点击确认：我已检查来源、资源与更新差异，并确认安装这些数据"}
        </button>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="settings-btn"
          disabled={!consent || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await installPluginPackage(
                candidate,
                previous?.digest ?? null,
                consent,
              );
              onInstalled();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "安装失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在核验并保存…" : "确认安装"}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

export function SettingsInstalledPackages() {
  const [records, setRecords] = useState<InstalledPluginPackage[]>([]),
    [candidate, setCandidate] = useState<ValidatedPluginPackage | null>(null);
  const [packageFeedback, setPackageFeedback] = useState<Record<string, { text: string; kind: "success" | "error" }>>({});
  const [expanded, setExpanded] = useState(true);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const feedbackTimers = useRef(new Map<string, number>());
  const resources = useSyncExternalStore(
    themeResources.subscribe,
    themeResources.getSnapshot,
  );
  const runtimeStatus = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.getStatus,
  );
  useEffect(() => {
    let mounted = true,
      generation = 0;
    const refresh = async () => {
      const requested = ++generation;
      try {
        const values = await listPluginPackages();
        if (mounted && requested === generation) setRecords(values);
      } catch {
        if (mounted) setMessage("无法读取本机插件存储");
      }
    };
    void refresh();
    const unsubscribe = subscribePluginPackages(() => {
      void refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => () => {
    feedbackTimers.current.forEach(timer => window.clearTimeout(timer));
    feedbackTimers.current.clear();
  }, []);
  const showPackageFeedback = (id: string, text: string, kind: "success" | "error") => {
    const oldTimer = feedbackTimers.current.get(id);
    if (oldTimer !== undefined) window.clearTimeout(oldTimer);
    const feedback = { text, kind } as const;
    setPackageFeedback(current => ({ ...current, [id]: feedback }));
    if (kind === "success") {
      const timer = window.setTimeout(() => {
        feedbackTimers.current.delete(id);
        setPackageFeedback(current => {
          if (current[id] !== feedback) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      }, 3000);
      feedbackTimers.current.set(id, timer);
    } else {
      feedbackTimers.current.delete(id);
    }
  };
  const togglePackage = async (record: InstalledPluginPackage, enabled: boolean) => {
    setBusy(true);
    setMessage("");
    setPackageFeedback(current => {
      const next = { ...current };
      delete next[record.id];
      return next;
    });
    setRecords(current => current.map(value => value.id === record.id ? { ...value, enabled } : value));
    try {
      await setPluginPackageEnabled(record, enabled);
      showPackageFeedback(record.id, enabled ? "已启用" : "已停用", "success");
    } catch (reason) {
      showPackageFeedback(record.id, `${enabled ? "启用" : "停用"}失败：${reason instanceof Error ? reason.message : "操作失败"}`, "error");
    } finally {
      try { setRecords(await listPluginPackages()); }
      catch { /* Preserve the operation result beside this package. */ }
      setBusy(false);
    }
  };
  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await operation();
      setMessage(success);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      try {
        setRecords(await listPluginPackages());
      } catch {
        /* Keep the failure message and durable state. */
      }
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="已安装声明式插件"
      className="settings-installed-packages"
    >
      <div className="plugin-section-heading">
        <h3>声明式插件包</h3>
        <button
          type="button"
          className="plugin-section-collapse"
          aria-label={`${expanded ? "折叠" : "展开"}声明式插件包`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        </button>
      </div>
      {expanded && <>
      <p className="settings-desc">
        支持成对主题配色、插入模板和文本片段。仅本机保存，安装前核验并明确确认；支持新建文档模板、受限宏与元数据查询；暂不安装脚本或自定义属性。
      </p>
      <input
        ref={input}
        type="file"
        hidden
        accept=".zip,.nrplugin.zip"
        aria-label="选择声明式插件包"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setMessage("");
          try {
            const { readPluginFile } =
              await import("../lib/plugin-system/package-validation");
            setCandidate(await readPluginFile(file));
          } catch (reason) {
            setMessage(
              reason instanceof Error ? reason.message : "无法读取插件包",
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        className="settings-btn"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "正在核验…" : "安装插件包…"}
      </button>
      {message && <p role="status">{message}</p>}
      <ul>
        {records.map((record) => (
          <li key={record.id}>
            <div className="settings-plugin-summary">
              <strong>{record.name}</strong>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label={`切换 ${record.name}`}
                  checked={record.enabled}
                  disabled={busy || record.trustedDigest !== record.digest}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    void togglePackage(record, checked);
                  }}
                />
                {record.enabled ? "停用" : "启用"}
              </label>
            </div>
            <p>
              {record.id} · {record.version} · 本机声明式包 ·{" "}
              {record.trustedDigest === record.digest
                ? "已确认内容"
                : "需重新审查"}
              <span className="installed-package-runtime-state">
                {record.enabled
                  ? !runtimeStatus.enabled
                    ? "全局插件功能未启用"
                    : runtimeStatus.activations.some((item) => item.pluginId === record.id)
                      ? "运行中"
                      : runtimeStatus.lastFailure?.pluginId === record.id && runtimeStatus.lastFailure.phase === "activate"
                        ? `激活失败 · ${runtimeStatus.lastFailure.code}`
                        : "正在激活…"
                  : "已停用"}
              </span>
            </p>
            {packageFeedback[record.id] && <p
              className={`installed-package-feedback ${packageFeedback[record.id].kind}`}
              role={packageFeedback[record.id].kind === "error" ? "alert" : "status"}
            >{packageFeedback[record.id].text}</p>}
            {record.enabled &&
              resources
                .filter((theme) => theme.id.startsWith(record.id + "/"))
                .map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className="settings-btn"
                    onClick={() => {
                      try {
                        saveThemePreference({
                          ...readThemePreference(),
                          enabled: true,
                          themeId: theme.id,
                        });
                        setMessage(`已使用 ${theme.name}`);
                      } catch {
                        setMessage("无法保存配色选择");
                      }
                    }}
                  >
                    使用 {theme.name}
                  </button>
                ))}
            <button
              type="button"
              className="settings-btn"
              disabled={busy}
              onClick={() => {
                void run(
                  () => removePluginPackage(record),
                  "已卸载插件，文档与排版设置保留",
                );
              }}
            >
              卸载 {record.name}
            </button>
          </li>
        ))}
      </ul>
      </>}
      {candidate && (
        <PackageConfirmation
          candidate={candidate}
          previous={records.find((row) => row.id === candidate.id)}
          onClose={() => setCandidate(null)}
          onInstalled={() => {
            setCandidate(null);
            setMessage("插件已安装，请在列表中明确启用");
          }}
        />
      )}
    </section>
  );
}
