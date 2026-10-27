import { useSyncExternalStore } from "react";
import { Field } from "./SettingsFields";
import { SettingsNumberInput } from "./SettingsNumberInput";
import {
  readStatusPreference,
  saveStatusPreference,
  subscribeStatusPreference,
  statusPreferenceSnapshot,
} from "../lib/plugin-system/builtin-status-display";
import {
  DEFAULT_STATUS_DISPLAY,
  STATUS_ITEMS,
  type StatusDisplay,
  type StatusItem,
} from "../lib/plugin-system/status-display";
const names: Record<StatusItem, string> = {
  navigation: "后退与前进",
  save: "本机保存状态",
  block: "块号",
  position: "阅读或光标位置",
  characters: "字符数",
  words: "词数",
};
export function SettingsStatusDisplay({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  useSyncExternalStore(subscribeStatusPreference, statusPreferenceSnapshot);
  const preference = readStatusPreference(),
    display = preference.display;
  const update = (patch: Partial<StatusDisplay>) => {
    try {
      saveStatusPreference({
        ...preference,
        display: { ...display, ...patch },
      });
      onMessage("已更新");
    } catch (error) {
      onMessage(String(error));
    }
  };
  const ordered = [
    ...display.items,
    ...STATUS_ITEMS.filter((k) => !display.items.includes(k)),
  ];
  return (
    <>
      <p className="settings-desc">
        接管渲染、源码和局部只读状态栏；原内置设置保留，停用恢复。状态栏隐藏或不含导航项时，前进/后退自动回到标题栏。保存失败提示不会被隐藏。
      </p>
      <div className="plugin-settings-grid">
        <section className="plugin-settings-group" aria-label="显示与排版">
          <h3>显示与排版</h3>
          {(
            [
              ["visible", "显示状态栏"],
              ["showInFocus", "专注模式显示状态栏"],
              ["showTotals", "显示总行数与总块数"],
              ["bold", "状态栏粗体"],
              ["italic", "状态栏斜体"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label} desc="">
              <input
                type="checkbox"
                aria-label={label}
                checked={key === "showTotals" ? display.showTotals !== false : display[key]}
                onChange={(e) => update({ [key]: e.target.checked })}
              />
            </Field>
          ))}
          <Field label="状态栏字体" desc="">
            <select
              aria-label="状态栏字体"
              value={display.font}
              onChange={(e) =>
                update({ font: e.target.value as StatusDisplay["font"] })
              }
            >
              {(["inherit", "mono", "sans", "serif"] as const).map(
                (font, i) => (
                  <option key={font} value={font}>
                    {["跟随界面", "等宽字体", "无衬线", "衬线"][i]}
                  </option>
                ),
              )}
            </select>
          </Field>
          {(
            [
              ["fontSize", "状态栏字号", 9, 20],
              ["paddingY", "上下留白", 0, 12],
              ["gap", "信息项间距", 2, 24],
            ] as const
          ).map(([key, label, min, max]) => (
            <Field key={key} label={`${label}（px）`} desc="">
              <SettingsNumberInput
                label={label}
                min={min}
                max={max}
                value={display[key]}
                onChange={value => update({ [key]: value })}
              />
            </Field>
          ))}
        </section>
        <section className="plugin-settings-group" aria-label="配色与信息项">
          <h3>配色与信息项</h3>
          {(["color", "background"] as const).map((key) => {
            const value = display[key],
              label = key === "color" ? "文字颜色" : "背景颜色";
            return (
              <Field
                key={key}
                label={label}
                desc="语义色跟随主题，自定义颜色分别设置浅色与深色。"
              >
                <select
                  aria-label={label}
                  value={typeof value === "string" ? value : "custom"}
                  onChange={(e) =>
                    update({
                      [key]:
                        e.target.value === "custom"
                          ? { light: "#657064", dark: "#aebbad" }
                          : e.target.value,
                    })
                  }
                >
                  {[
                    "secondary",
                    "text",
                    "accent",
                    "transparent",
                    "surface",
                    "active",
                    "custom",
                  ].map((c, i) => (
                    <option key={c} value={c}>
                      {
                        [
                          "次要文字",
                          "正文",
                          "强调色",
                          "透明",
                          "表面",
                          "高亮",
                          "自定义浅深配色",
                        ][i]
                      }
                    </option>
                  ))}
                </select>
                {typeof value === "object" && (
                  <div className="numbering-color-pair">
                    {(["light", "dark"] as const).map((mode) => (
                      <label key={mode}>
                        {mode === "light" ? "浅色" : "深色"}
                        <input
                          type="color"
                          aria-label={`${label}${mode}`}
                          value={value[mode]}
                          onChange={(e) =>
                            update({
                              [key]: { ...value, [mode]: e.target.value },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </Field>
            );
          })}
          <h4>信息项与顺序</h4>
          <ol className="status-display-items">
            {ordered.map((item) => {
              const index = display.items.indexOf(item);
              const move = (step: number) => {
                const items = [...display.items];
                [items[index], items[index + step]] = [
                  items[index + step],
                  items[index],
                ];
                update({ items });
              };
              return (
                <li key={item}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`显示${names[item]}`}
                      checked={index >= 0}
                      onChange={(e) =>
                        update({
                          items: e.target.checked
                            ? [...display.items, item]
                            : display.items.filter((k) => k !== item),
                        })
                      }
                    />
                    {names[item]}
                  </label>
                  <button
                    type="button"
                    aria-label={`${names[item]}前移`}
                    disabled={index <= 0}
                    onClick={() => move(-1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`${names[item]}后移`}
                    disabled={index < 0 || index === display.items.length - 1}
                    onClick={() => move(1)}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      <button type="button" onClick={() => update(DEFAULT_STATUS_DISPLAY)}>
        恢复状态栏默认值
      </button>
    </>
  );
}
