import { useState, useSyncExternalStore } from "react";
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

export function SettingsNumberingDisplay({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  useSyncExternalStore(
    subscribeNumberingPreference,
    numberingPreferenceSnapshot,
  );
  const [target, setTarget] = useState<NumberingTarget>("blocks");
  const preference = readNumberingPreference();
  const display = preference.displays.find((item) => item.target === target)!;
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
      {(
        [
          ["visible", "显示编号"],
          ["relative", "相对编号"],
          ["bold", "编号粗体"],
          ["italic", "编号斜体"],
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
        <input
          type="number"
          aria-label="编号字号"
          min={9}
          max={24}
          defaultValue={display.fontSize}
          key={`${target}:${display.fontSize}`}
          onBlur={(event) => update({ fontSize: Number(event.target.value) })}
        />
      </Field>
      <Field desc="" label="相对编号当前项对齐">
        <select
          aria-label="相对编号当前项对齐"
          value={display.currentAlignment}
          onChange={(event) =>
            update({ currentAlignment: event.target.value as "left" | "right" })
          }
        >
          <option value="left">左对齐</option>
          <option value="right">右对齐</option>
        </select>
      </Field>
      {color("color", "编号颜色")}
      {color("background", "编号区域背景")}
      {color("currentColor", "当前编号颜色")}
      {color("currentBackground", "当前编号背景")}
      {(
        [
          ["foldCollapsed", "折叠状态符号"],
          ["foldExpanded", "展开状态符号"],
        ] as const
      ).map(([key, label]) => (
        <Field desc="" key={`${target}:${key}`} label={label}>
          <input
            type="text"
            aria-label={label}
            maxLength={8}
            defaultValue={display[key]}
            onBlur={(event) => update({ [key]: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing)
                event.currentTarget.blur();
            }}
          />
        </Field>
      ))}
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
