import { useEffect, useState, useSyncExternalStore } from "react";
import { Field, SettingsSection } from "./SettingsFields";
import {
  DEFAULT_TREE_DISPLAY,
  readTreeDisplayPreference,
  saveTreeDisplayPreference,
  subscribeTreeDisplayPreference,
  treeDisplayPreferenceSnapshot,
} from "../lib/plugin-system/builtin-tree-display";
import type { PanelDisplayContribution } from "../lib/plugin-system/panel-display";

function DisplayNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const next = Number(text);
        if (text && Number.isInteger(next) && next >= min && next <= max)
          onChange(next);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

export function SettingsTreeDisplay({
  pluginsEnabled,
  onMessage,
}: {
  pluginsEnabled: boolean;
  onMessage: (message: string) => void;
}) {
  useSyncExternalStore(
    subscribeTreeDisplayPreference,
    treeDisplayPreferenceSnapshot,
  );
  const preference = readTreeDisplayPreference();
  const save = (enabled: boolean, display = preference.display) => {
    try {
      saveTreeDisplayPreference({ enabled, display });
      onMessage("已更新");
    } catch {
      onMessage("无法保存文档树展示设置");
    }
  };
  const update = (patch: Partial<PanelDisplayContribution>) =>
    save(preference.enabled, { ...preference.display, ...patch });
  return (
    <SettingsSection
      title="文档树展示扩展"
      desc="展示插件只改变外观和工具入口，文档及分栏仍由宿主管理。"
    >
      <Field
        label="内置文档树展示插件"
        desc="仅本设备生效。关闭后恢复原有展示，保留选中、折叠与分栏状态。需先开启插件功能。"
      >
        <label className="settings-toggle">
          <input
            type="checkbox"
            aria-label="内置文档树展示插件"
            disabled={!pluginsEnabled}
            checked={preference.enabled}
            onChange={(event) => save(event.target.checked)}
          />
          <span className="toggle-track" />
          <span className="toggle-label">
            {preference.enabled ? "开" : "关"}
          </span>
        </label>
      </Field>
      <>
        <Field label="文档树字体" desc="">
          <select
            aria-label="文档树字体"
            value={preference.display.font}
            onChange={(event) =>
              update({
                font: event.target.value as PanelDisplayContribution["font"],
              })
            }
          >
            <option value="inherit">跟随风格</option>
            <option value="sans">无衬线</option>
            <option value="mono">等宽</option>
          </select>
        </Field>
        <Field label="文档树字号" desc="">
          <DisplayNumber
            label="文档树字号"
            min={12}
            max={20}
            value={preference.display.fontSize}
            onChange={(value) => update({ fontSize: value })}
          />{" "}
          px
        </Field>
        <Field label="文档树行高" desc="">
          <DisplayNumber
            label="文档树行高"
            min={28}
            max={48}
            value={preference.display.rowHeight}
            onChange={(value) => update({ rowHeight: value })}
          />{" "}
          px
        </Field>
        <Field
          label="文档名称颜色"
          desc="使用当前浅色或深色主题的语义配色；路径层次配色保持原有设置。"
        >
          <select
            aria-label="文档名称颜色"
            value={preference.display.labelColor}
            onChange={(event) =>
              update({
                labelColor: event.target
                  .value as PanelDisplayContribution["labelColor"],
              })
            }
          >
            <option value="inherit">跟随风格</option>
            <option value="secondary">次要文本色</option>
            <option value="accent">主题强调色</option>
          </select>
        </Field>
        <Field label="悬停提示" desc="">
          <select
            aria-label="文档树悬停提示"
            value={preference.display.tooltip}
            onChange={(event) =>
              update({
                tooltip: event.target
                  .value as PanelDisplayContribution["tooltip"],
              })
            }
          >
            <option value="path">完整路径</option>
            <option value="name">名称</option>
          </select>
        </Field>
        <Field label="辅助信息" desc="">
          <label>
            <input
              type="checkbox"
              checked={preference.display.showCounts}
              onChange={(event) => update({ showCounts: event.target.checked })}
            />
            路径文档数
          </label>
          <label>
            <input
              type="checkbox"
              checked={preference.display.showMetadata}
              onChange={(event) =>
                update({ showMetadata: event.target.checked })
              }
            />
            文档类型
          </label>
        </Field>
        <Field label="扩展工具栏" desc="">
          <label>
            <input
              type="checkbox"
              checked={preference.display.toolbar.length > 0}
              onChange={(event) =>
                update({
                  toolbar: event.target.checked
                    ? DEFAULT_TREE_DISPLAY.toolbar
                    : [],
                })
              }
            />
            展开所有目录、刷新文档树
          </label>
        </Field>
        <button
          type="button"
          className="btn"
          onClick={() => save(preference.enabled, DEFAULT_TREE_DISPLAY)}
        >
          恢复文档树展示默认设置
        </button>
      </>
    </SettingsSection>
  );
}
