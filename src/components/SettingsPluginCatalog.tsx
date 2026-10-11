import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  BUILTIN_PLUGIN_CATALOG,
  type BuiltinPluginDescription,
} from "../lib/plugin-system/builtin-plugin-catalog";
import { pluginRuntime } from "../lib/plugin-system/runtime";
import { pluginLifecycle } from "../lib/plugin-system/lifecycle";
import {
  readTreeDisplayPreference,
  subscribeTreeDisplayPreference,
  treeDisplayPreferenceSnapshot,
} from "../lib/plugin-system/builtin-tree-display";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { SettingsTreeDisplay } from "./SettingsTreeDisplay";
import { ToolbarIcon } from "./ToolbarIcon";
import { Field } from "./SettingsFields";
import {
  readResultPresentation,
  saveResultPresentation,
  subscribeResultPresentation,
  resultPresentationSnapshot,
} from "../lib/plugin-system/result-presentation";
import "./settings-plugins.css";

function PluginConfigurationDialog({
  plugin,
  onClose,
  trigger,
}: {
  plugin: BuiltinPluginDescription;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
}) {
  useSyncExternalStore(subscribeResultPresentation, resultPresentationSnapshot);
  const tool = plugin.id === "nine-rings.builtin-date" ? "date" : "statistics";
  const presentation = readResultPresentation(tool);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const status = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.getStatus,
  );
  const active = status.activations.find((item) => item.pluginId === plugin.id);
  const { message, showMessage } = useTransientMessage();
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useDialogFocus(dialog, true, close, trigger, true);
  return createPortal(
    <dialog
      ref={dialog}
      className="settings-panel plugin-config-dialog"
      aria-label={`${plugin.name}配置`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="plugin-config-heading">
        <h2>{plugin.name}</h2>
        <button
          ref={close}
          type="button"
          className="btn-icon"
          title="关闭插件配置"
          aria-label="关闭插件配置"
          onClick={onClose}
        >
          <ToolbarIcon name="close" />
        </button>
      </header>
      <div className="plugin-config-feedback" role="status" aria-live="polite">
        {message}
      </div>
      <div className="plugin-config-body">
        <p className="settings-desc">
          内置 · {plugin.type} · {plugin.description}
        </p>
        {plugin.configuration === "tree-display" ? (
          <SettingsTreeDisplay
            pluginsEnabled={status.enabled}
            onMessage={showMessage}
          />
        ) : (
          <>
            <Field
              label="结果展示"
              desc="在文档标题栏的内置插件菜单中调用；展示方式不改变插件权限。"
            >
              <select
                aria-label="结果展示"
                value={presentation.surface}
                onChange={(event) => {
                  saveResultPresentation(tool, {
                    ...presentation,
                    surface: event.target.value as "status" | "popup",
                  });
                  showMessage("已更新");
                }}
              >
                <option value="status">状态栏</option>
                <option value="popup">弹层</option>
              </select>
            </Field>
            <Field
              label="弹层位置"
              desc="相对于文本编辑区定位；状态栏隐藏时使用弹层。"
            >
              <select
                aria-label="弹层位置"
                value={presentation.position}
                onChange={(event) => {
                  saveResultPresentation(tool, {
                    ...presentation,
                    position: event.target.value as "top" | "center" | "bottom",
                  });
                  showMessage("已更新");
                }}
              >
                <option value="top">上方</option>
                <option value="center">中央</option>
                <option value="bottom">下方</option>
              </select>
            </Field>
            {plugin.id === "nine-rings.builtin-date" ? (
              <Field
                label="日期格式"
                desc="使用本机日期，格式固定为 YYYY-MM-DD；插入在当前编辑器中形成一次撤销。"
              >
                <p>只读文档不能插入日期。</p>
              </Field>
            ) : (
              <Field
                label="统计范围"
                desc="当前文档的纯文本；字符数按 Unicode 字符计算，支持只读文档。"
              >
                <p>关闭统计结果会释放订阅，不读取其它文档。</p>
              </Field>
            )}
          </>
        )}
        <Field
          label="运行与权限"
          desc={
            active
              ? "插件当前已激活。停用后释放所属资源，保留文档数据。"
              : plugin.configuration === "tree-display"
                ? "未激活；开启展示选项后自动激活。"
                : "未激活；从文档菜单调用时按需激活。"
          }
        >
          <p>
            权限：
            {active?.permissions.length
              ? active.permissions.join("、")
              : plugin.configuration === "tree-display"
                ? "无需文档读写权限"
                : plugin.id === "nine-rings.builtin-date"
                  ? "当前选区读写、当前文档读取"
                  : "当前文档读取"}
          </p>
          {active && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void pluginLifecycle
                  .deactivate(plugin.id)
                  .then(() => showMessage("插件已停用"))
                  .catch(() =>
                    showMessage("插件停用失败，请关闭插件功能后重试"),
                  );
              }}
            >
              停用插件
            </button>
          )}
        </Field>
      </div>
    </dialog>,
    document.body,
  );
}

export function SettingsPluginCatalog() {
  const [selected, setSelected] = useState<BuiltinPluginDescription | null>(
    null,
  );
  const trigger = useRef<HTMLElement | null>(null);
  const status = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.getStatus,
  );
  useSyncExternalStore(
    subscribeTreeDisplayPreference,
    treeDisplayPreferenceSnapshot,
  );
  const treeEnabled = readTreeDisplayPreference().enabled;
  return (
    <aside className="settings-plugin-catalog" aria-label="插件列表">
      <h3>插件列表</h3>
      <p className="settings-desc">
        {BUILTIN_PLUGIN_CATALOG.length} 个内置插件 · 点击名称查看配置
      </p>
      <ul>
        {BUILTIN_PLUGIN_CATALOG.map((plugin) => {
          const active = status.activations.some(
            (item) => item.pluginId === plugin.id,
          );
          const state = active
            ? "运行中"
            : plugin.configuration === "tree-display"
              ? treeEnabled
                ? "已停用"
                : "未启用"
              : "按需调用";
          return (
            <li key={plugin.id} data-plugin-id={plugin.id}>
              <div className="settings-plugin-summary">
                <button
                  type="button"
                  className="settings-plugin-name"
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    trigger.current = event.currentTarget;
                    setSelected(plugin);
                  }}
                >
                  {plugin.name}
                </button>
                <span className="settings-plugin-state">{state}</span>
              </div>
              <span className="settings-plugin-type">内置 · {plugin.type}</span>
              <p>{plugin.description}</p>
            </li>
          );
        })}
      </ul>
      {selected && (
        <PluginConfigurationDialog
          plugin={selected}
          trigger={trigger}
          onClose={() => setSelected(null)}
        />
      )}
    </aside>
  );
}
