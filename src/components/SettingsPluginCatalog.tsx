import {
  imageViewerEnabled,
  saveImageViewerEnabled,
  subscribeImageViewer,
  imageViewerSnapshot,
} from "../lib/plugin-system/builtin-image-viewer";
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
  saveTreeDisplayPreference,
  readTreeDisplayPreference,
  subscribeTreeDisplayPreference,
  treeDisplayPreferenceSnapshot,
} from "../lib/plugin-system/builtin-tree-display";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { outlineDisplay } from "../lib/plugin-system/builtin-outline-display";
import { SettingsPanelDisplay } from "./SettingsPanelDisplay";
import { ToolbarIcon } from "./ToolbarIcon";
import { Field } from "./SettingsFields";
import {
  readResultPresentation,
  saveResultPresentation,
  subscribeResultPresentation,
  resultPresentationSnapshot,
} from "../lib/plugin-system/result-presentation";
import {
  documentToolEnabled,
  saveDocumentToolEnabled,
  subscribeDocumentTools,
  documentToolsSnapshot,
} from "../lib/plugin-system/builtin-tool-preferences";
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
  const tool =
    plugin.id === "nine-rings.builtin-date"
      ? "date"
      : plugin.id === "nine-rings.builtin-image"
        ? "image"
        : "statistics";
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
        <span
          className="plugin-config-feedback"
          role="status"
          aria-live="polite"
        >
          {message}
        </span>
        <button
          ref={close}
          type="button"
          className="btn-icon"
          aria-label="关闭插件配置"
          onClick={onClose}
        >
          <ToolbarIcon name="close" />
        </button>
      </header>
      <div className="plugin-config-body">
        <p className="settings-desc">
          内置 · {plugin.type} · {plugin.description}
        </p>
        {plugin.configuration === "image-viewer" ? (
          <p className="settings-desc">
            在左侧「图片」分栏选择目录；手机从文档树工具栏进入。目录授权仅保存在本机，不进入备份。浏览器能力不足时，文件选择仅在当前会话有效。预览旋转不修改原图，图片处理功能将在后续独立接入。
          </p>
        ) : plugin.configuration === "tree-display" ||
          plugin.configuration === "outline-display" ? (
          <SettingsPanelDisplay
            outline={plugin.configuration === "outline-display"}
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
                desc="使用本机日期与时间；在 + 菜单的二级选项选择格式，插入在当前编辑器中形成一次撤销。"
              >
                <p>只读文档不能插入日期。</p>
              </Field>
            ) : plugin.id === "nine-rings.builtin-image" ? (
              <Field
                label="图片参数"
                desc="在 + 菜单选择插入图片，设置类型、地址、替代文本、标题及链接等参数。"
              >
                <p>
                  只读文档不能插入图片；引用名称自动加唯一后缀，避免覆盖已有定义。
                </p>
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
              ? "插件当前已激活。开启与停用请在插件列表操作。"
              : plugin.configuration === "tree-display" ||
                  plugin.configuration === "outline-display"
                ? "未激活；开启展示选项后自动激活。"
                : "未激活；从文档菜单调用时按需激活。"
          }
        >
          <p>
            权限：
            {active?.permissions.length
              ? active.permissions.join("、")
              : plugin.configuration === "image-viewer"
                ? "分栏展示、授权图片目录读取；插入文档另经编辑插件命令"
                : plugin.configuration === "tree-display" ||
                    plugin.configuration === "outline-display"
                  ? "无需文档读写权限"
                  : plugin.id !== "nine-rings.builtin-statistics"
                    ? "当前选区读写、当前文档读取"
                    : "当前文档读取"}
          </p>
        </Field>
      </div>
    </dialog>,
    document.body,
  );
}

export function SettingsPluginCatalog() {
  const { message, showMessage } = useTransientMessage();
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
  useSyncExternalStore(subscribeDocumentTools, documentToolsSnapshot);
  useSyncExternalStore(subscribeImageViewer, imageViewerSnapshot);
  useSyncExternalStore(outlineDisplay.subscribe, outlineDisplay.snapshot);
  const treeEnabled = readTreeDisplayPreference().enabled;
  const outlineEnabled = outlineDisplay.read().enabled;
  return (
    <aside className="settings-plugin-catalog" aria-label="插件列表">
      <h3>插件列表</h3>
      <p className="settings-desc">
        {BUILTIN_PLUGIN_CATALOG.length} 个内置插件 · 点击名称查看配置
      </p>
      {message && <p role="status">{message}</p>}
      <ul>
        {BUILTIN_PLUGIN_CATALOG.map((plugin) => {
          const active = status.activations.some(
            (item) => item.pluginId === plugin.id,
          );
          const tool =
            plugin.id === "nine-rings.builtin-date"
              ? "date"
              : plugin.id === "nine-rings.builtin-image"
                ? "image"
                : "statistics";
          const enabled =
            plugin.configuration === "image-viewer"
              ? imageViewerEnabled()
              : plugin.configuration === "tree-display" ||
                  plugin.configuration === "outline-display"
                ? plugin.configuration === "outline-display"
                  ? outlineEnabled
                  : treeEnabled
                : documentToolEnabled(tool);
          const state = !enabled
            ? "已停用"
            : active
              ? "运行中"
              : plugin.configuration === "tree-display" ||
                  plugin.configuration === "outline-display"
                ? (
                    plugin.configuration === "outline-display"
                      ? outlineEnabled
                      : treeEnabled
                  )
                  ? "等待激活"
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
              </div>
              <div className="settings-plugin-metadata">
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    aria-label={`启用${plugin.name}`}
                    checked={enabled}
                    onChange={(event) => {
                      try {
                        if (plugin.configuration === "image-viewer")
                          saveImageViewerEnabled(event.target.checked);
                        else if (
                          plugin.configuration === "tree-display" ||
                          plugin.configuration === "outline-display"
                        )
                          (plugin.configuration === "outline-display"
                            ? outlineDisplay.save
                            : saveTreeDisplayPreference)({
                            ...(plugin.configuration === "outline-display"
                              ? outlineDisplay.read()
                              : readTreeDisplayPreference()),
                            enabled: event.target.checked,
                          });
                        else
                          saveDocumentToolEnabled(tool, event.target.checked);
                        if (!event.target.checked)
                          void pluginLifecycle
                            .deactivate(plugin.id)
                            .catch(() => {});
                      } catch {
                        showMessage("无法保存插件开关，请检查本地存储后重试");
                      }
                    }}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-label">{enabled ? "开" : "关"}</span>
                </label>
                <span className="settings-plugin-type">
                  内置 · {plugin.type}
                </span>
                <span className="settings-plugin-state">{state}</span>
              </div>
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
