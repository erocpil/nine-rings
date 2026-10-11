import { useSyncExternalStore } from "react";
import { pluginRuntime } from "../lib/plugin-system/runtime";

export function PluginRuntimeStatus() {
  const status = useSyncExternalStore(
    pluginRuntime.subscribe,
    pluginRuntime.getStatus,
  );
  return (
    <div role="group" aria-label="插件运行状态">
      <p className="settings-desc">
        {status.enabled ? "已开启" : "已关闭"} · {status.activations.length}{" "}
        个活动插件
      </p>
      {status.lastFailure && (
        <p role="status">
          最近异常：{status.lastFailure.pluginId} ·{" "}
          {status.lastFailure.phase === "activate" ? "激活" : "停用"} ·{" "}
          {status.lastFailure.code}
        </p>
      )}
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
        </div>
      ))}
    </div>
  );
}
