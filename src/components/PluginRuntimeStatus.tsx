import { Field } from "./SettingsFields";
import { useSyncExternalStore } from "react";
import { pluginRuntime } from "../lib/plugin-system/runtime";

export function PluginRuntimeStatus() {
  const status = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.getStatus,
  );
  return (
    <Field
      label="插件运行状态"
      desc={`${status.enabled ? "已开启" : "已关闭"} · ${status.activations.length} 个活动插件。当前仅支持可信内置宿主，第三方安装尚未开放。`}
    >
      {status.cleanupFailures > 0 && (
        <p role="status">
          {status.cleanupFailures}{" "}
          次资源清理异常；其它资源仍已尝试释放。可关闭插件功能后重新开启。
        </p>
      )}
      {status.activations.map((item) => (
        <div key={item.generation}>
          <strong>{item.pluginId}</strong>
          <p className="settings-desc">
            权限：
            {item.permissions.length ? item.permissions.join("、") : "无"} ·
            托管资源：{item.resources}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => pluginRuntime.deactivate(item.pluginId)}
          >
            停用 {item.pluginId}
          </button>
        </div>
      ))}
    </Field>
  );
}
