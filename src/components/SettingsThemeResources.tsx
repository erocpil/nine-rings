import { useSyncExternalStore } from "react";
import { BUILTIN_THEME_RESOURCES } from "../lib/plugin-system/builtin-theme-resources";
import {
  DEFAULT_THEME_PREFERENCE,
  readThemePreference,
  saveThemePreference,
  subscribeThemePreference,
  themePreferenceSnapshot,
} from "../lib/plugin-system/theme-preferences";
import { themeResources } from "../lib/plugin-system/theme-resources";
import { Field } from "./SettingsFields";

export function SettingsThemeResources({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  useSyncExternalStore(subscribeThemePreference, themePreferenceSnapshot);
  const registered = useSyncExternalStore(
    themeResources.subscribe,
    themeResources.getSnapshot,
  );
  const preference = readThemePreference();
  const available = [
    ...BUILTIN_THEME_RESOURCES,
    ...registered.filter(
      (theme) =>
        !BUILTIN_THEME_RESOURCES.some((value) => value.id === theme.id),
    ),
  ];
  const following = preference.themeId === "follow";
  const selected = available.find((theme) => theme.id === preference.themeId);
  const save = (patch: Partial<typeof preference>) => {
    try {
      saveThemePreference({ ...preference, ...patch });
      onMessage("已更新");
    } catch {
      onMessage("无法保存主题偏好，请检查本地存储后重试");
    }
  };
  return (
    <>
      <Field
        label="配色资源"
        desc="只替换配色，不改变风格的布局、分栏和交互；浅深模式继续跟随外观设置。"
      >
        <select
          aria-label="配色资源"
          value={preference.themeId}
          onChange={(event) => save({ themeId: event.target.value })}
        >
          {!selected && !following && (
            <option value={preference.themeId}>主题不可用（保留选择）</option>
          )}
          <option value="follow">跟随当前内置风格</option>
          {available.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </Field>
      {!selected && !following && (
        <p role="status" className="settings-desc">
          所选资源缺失，当前使用原风格；资源恢复后可继续使用，无需重设偏好。
        </p>
      )}
      {following && (
        <p className="settings-desc">
          配色随界面风格切换；经典保留原有命名主题。仅明确选择其它配色时覆盖，布局和用户排版保持原设置。
        </p>
      )}
      {selected && (
        <div className="plugin-theme-previews" aria-label="浅深配色预览">
          {(["light", "dark"] as const).map((mode) => {
            const colors = selected[mode];
            return (
              <div
                key={mode}
                className="plugin-theme-preview"
                style={{
                  background: colors.bg,
                  color: colors.text,
                  borderColor: colors.border,
                }}
              >
                <strong>{mode === "light" ? "浅色" : "深色"}</strong>
                <span style={{ color: colors.muted }}>正文与辅助信息</span>
                <span style={{ color: colors.accent }}>链接与强调色</span>
                <code
                  style={{
                    background: colors.code,
                    color: colors.syntaxKeyword,
                  }}
                >
                  const theme = …
                </code>
              </div>
            );
          })}
        </div>
      )}
      <Field
        label="使用主题排版建议"
        desc="应用标题默认比例及代码、引用、流程块的默认字体；标题自定义字号、块字体和字号优先。正文、源码字体、行距及块间距继续使用排版设置。"
      >
        <input
          type="checkbox"
          aria-label="使用主题排版建议"
          checked={preference.typography}
          onChange={(event) => save({ typography: event.target.checked })}
        />
      </Field>
      <button
        type="button"
        className="settings-btn"
        onClick={() =>
          save({
            themeId: DEFAULT_THEME_PREFERENCE.themeId,
            typography: DEFAULT_THEME_PREFERENCE.typography,
          })
        }
      >
        恢复主题默认配置
      </button>
      <p className="settings-desc">
        停用插件或资源不可用时恢复原风格。配色选择仅保存在本机，不修改文档、排版设置或云端备份；首版不安装第三方主题。
      </p>
    </>
  );
}
