import { useEffect, useState, useSyncExternalStore } from "react";
import { SettingsNumberInput } from "./SettingsNumberInput";
import { Field } from "./SettingsFields";
import {
  DEFAULT_NUMBERING_DISPLAYS,
  numberingPreferenceSnapshot,
  readNumberingPreference,
  saveNumberingPreference,
  subscribeNumberingPreference,
} from "../lib/plugin-system/builtin-numbering-display";
import type {
  NumberingColor,
  NumberingDisplay,
  NumberingTarget,
} from "../lib/plugin-system/numbering-display";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
  saveBlockWorkspacePreferences,
} from "../lib/block-display-settings";

const subscribeFoldConnector = (listener: () => void) => {
  window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};
const foldConnectorSnapshot = () => {
  const preferences = blockWorkspacePreferences();
  return `${preferences.sourceFoldConnectorStyle ?? "solid"}:${preferences.sourceFoldConnectorWidth ?? 2}:${preferences.sourceFoldConnectorOpacity ?? 100}`;
};

export function SettingsNumberingDisplay({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  useSyncExternalStore(
    subscribeNumberingPreference,
    numberingPreferenceSnapshot,
  );
  useSyncExternalStore(subscribeFoldConnector, foldConnectorSnapshot);
  const [target, setTarget] = useState<NumberingTarget>("blocks");
  const preference = readNumberingPreference();
  const display = preference.displays.find((item) => item.target === target)!;
  const foldConnector = blockWorkspacePreferences();
  const update = (patch: Partial<NumberingDisplay>) => {
    try {
      saveNumberingPreference({
        ...preference,
        displays: preference.displays.map((item) =>
          item.target === target ? { ...item, ...patch } : item,
        ),
      });
      onMessage("已更新");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "保存失败");
    }
  };
  const color = (
    key: "color" | "background" | "currentColor" | "currentBackground",
    label: string,
  ) => {
    const value = display[key];
    return (
      <Field desc="" key={key} label={label}>
        <select
          aria-label={label}
          value={typeof value === "string" ? value : "custom"}
          onChange={(event) =>
            update({
              [key]:
                event.target.value === "custom"
                  ? {
                      light: key.toLowerCase().includes("background")
                        ? "#e8ede6"
                        : "#596958",
                      dark: key.toLowerCase().includes("background")
                        ? "#303c33"
                        : "#a5bba5",
                    }
                  : (event.target.value as NumberingColor),
            })
          }
        >
          <option value="text">跟随正文</option>
          <option value="secondary">主题次要文字</option>
          <option value="accent">主题强调色</option>
          <option value="transparent">透明</option>
          <option value="surface">主题表面</option>
          <option value="active">主题高亮背景</option>
          <option value="custom">自定义浅色 / 深色</option>
        </select>
        {typeof value === "object" && (
          <div className="numbering-color-pair">
            {(["light", "dark"] as const).map((mode) => (
              <label key={mode}>
                {mode === "light" ? "浅色" : "深色"}
                <input
                  type="color"
                  aria-label={`${label}${mode === "light" ? "浅色" : "深色"}`}
                  value={value[mode]}
                  onChange={(event) =>
                    update({ [key]: { ...value, [mode]: event.target.value } })
                  }
                />
              </label>
            ))}
          </div>
        )}
      </Field>
    );
  };
  return (
    <>
      <Field desc="" label="配置目标">
        <select
          aria-label="编号配置目标"
          value={target}
          onChange={(event) => setTarget(event.target.value as NumberingTarget)}
        >
          <option value="blocks">渲染块号</option>
          <option value="source">源码行号</option>
        </select>
      </Field>
      <p className="settings-desc">
        启用后接管对应编号与折叠符号的展示；系统内置设置暂时禁用但保留原值。停用后恢复。浅深颜色可分开设置，不影响正文、折叠状态或块菜单。
      </p>
      <div className="plugin-settings-grid numbering-settings-grid">
        <section className="plugin-settings-group numbering-settings-group" aria-label="编号与文字">
          <h3>编号与文字</h3>
          {(
            [
              ["visible", "显示编号"],
              ["relative", "相对编号"],
              ["bold", "编号粗体"],
              ["italic", "编号斜体"],
            ] as const
          ).map(([key, label]) => (
            <Field desc="" key={key} label={label}>
              <input
                type="checkbox"
                aria-label={label}
                checked={display[key]}
                onChange={(event) => update({ [key]: event.target.checked })}
              />
            </Field>
          ))}
          <Field desc="" label="编号字体">
            <select
              aria-label="编号字体"
              value={display.font}
              onChange={(event) =>
                update({ font: event.target.value as NumberingDisplay["font"] })
              }
            >
              <option value="inherit">跟随编辑区</option>
              <option value="mono">等宽字体</option>
              <option value="sans">系统无衬线</option>
              <option value="serif">衬线字体</option>
            </select>
          </Field>
          <Field desc="" label="编号字号">
            <SettingsNumberInput
              label="编号字号"
              min={9}
              max={24}
              value={display.fontSize}
              key={target}
              onChange={value => update({ fontSize: value })}
            />
          </Field>
          {color("color", "编号颜色")}
          {color("background", "编号区域背景")}
          {target === "source" && <>
            <h3>行号分隔线</h3>
            <p className="settings-desc">设置源码行号右侧的竖线和两侧留白；线宽设为 0px 时不显示竖线。</p>
            {([
              ["sourceDividerWidth", "竖线宽度", 4],
              ["sourceDividerLeftSpace", "竖线左侧留白", 24],
              ["sourceDividerRightSpace", "竖线右侧留白", 24],
            ] as const).map(([key, label, maximum]) => <Field key={key} desc="" label={label}>
              <SettingsNumberInput label={label} min={0} max={maximum} value={display[key]} key={`${target}:${key}`} onChange={value => update({ [key]: value })} />
            </Field>)}
          </>}
        </section>
        <section
          className="plugin-settings-group numbering-settings-group"
          aria-label="当前编号与折叠"
        >
          <h3>当前编号与折叠</h3>
          {(
            [
              ["highlightCurrent", "高亮当前编号"],
              ["currentBold", "当前编号粗体"],
            ] as const
          ).map(([key, label]) => (
            <Field desc="" key={key} label={label}>
              <input
                type="checkbox"
                aria-label={label}
                checked={display[key]}
                onChange={(event) => update({ [key]: event.target.checked })}
              />
            </Field>
          ))}
          <Field desc="" label="相对编号当前项对齐">
            <select
              aria-label="相对编号当前项对齐"
              disabled={!display.relative}
              value={display.currentAlignment}
              onChange={(event) =>
                update({
                  currentAlignment: event.target.value as "left" | "right",
                })
              }
            >
              <option value="left">左对齐</option>
              <option value="right">右对齐</option>
            </select>
          </Field>
          {color("currentColor", "当前编号颜色")}
          {color("currentBackground", "当前编号背景")}
          {(
            [
              ["foldCollapsed", "折叠状态符号"],
              ["foldExpanded", "展开状态符号"],
            ] as const
          ).map(([key, label]) => (
            <Field desc="" key={`${target}:${key}`} label={label}>
              <NumberingSymbolInput label={label} value={display[key]} onChange={value => update({ [key]: value })} />
            </Field>
          ))}
          {target === "source" && <>
            <h3>折叠连接线</h3>
            <p className="settings-desc">宿主统一管理连接线；编号插件接管折叠符号时同样生效，并与源码状态栏、编辑器设置同步。</p>
            <Field desc="" label="连接线样式">
              <select aria-label="编号展示折叠连接线样式" value={foldConnector.sourceFoldConnectorStyle ?? "solid"} onChange={event => saveBlockWorkspacePreferences({ sourceFoldConnectorStyle: event.target.value as "solid" | "dashed" | "dotted" | "none" })}>
                <option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option><option value="none">不显示</option>
              </select>
            </Field>
            <Field desc="" label="连接线宽度">
              <select aria-label="编号展示折叠连接线宽度" disabled={foldConnector.sourceFoldConnectorStyle === "none"} value={foldConnector.sourceFoldConnectorWidth ?? 2} onChange={event => saveBlockWorkspacePreferences({ sourceFoldConnectorWidth: Number(event.target.value) as 1 | 2 | 3 | 4 })}>
                <option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option>
              </select>
            </Field>
            <Field desc="" label="连接线透明度">
              <select aria-label="编号展示折叠连接线透明度" disabled={foldConnector.sourceFoldConnectorStyle === "none"} value={foldConnector.sourceFoldConnectorOpacity ?? 100} onChange={event => saveBlockWorkspacePreferences({ sourceFoldConnectorOpacity: Number(event.target.value) as 25 | 50 | 75 | 100 })}>
                <option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option>
              </select>
            </Field>
          </>}
        </section>
      </div>
      <button
        type="button"
        className="settings-btn"
        onClick={() =>
          update(
            DEFAULT_NUMBERING_DISPLAYS.find((item) => item.target === target)!,
          )
        }
      >
        恢复当前目标默认配置
      </button>
    </>
  );
}

function NumberingSymbolInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input type="text" aria-label={label} maxLength={8} value={draft} onChange={event => {
    const text = event.currentTarget.value;
    setDraft(text);
    if (text.trim() && Array.from(text).length <= 4 && Array.from(text).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && text !== value) onChange(text);
  }} onBlur={() => setDraft(value)} onKeyDown={event => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
  }} />;
}
