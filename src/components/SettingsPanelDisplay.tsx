import { useEffect, useState, useSyncExternalStore } from "react";
import { Field, SettingsSection } from "./SettingsFields";
import { panelPresenter } from "../lib/plugin-system/builtin-panel-presenters";
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

export function SettingsPanelDisplay({
  onMessage,
  configuration = "tree-display",
}: {
  onMessage: (message: string) => void;
  configuration?: string;
}) {
  const controller = panelPresenter(configuration)!;
  const outline = configuration === "outline-display";
  const bookmark = configuration === "bookmark-display";
  const notes = configuration === "notes-display";
  const name = outline ? "目录" : bookmark ? "书签" : notes ? "随记" : "文档树";
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  const preference = controller.read();
  const save = (enabled: boolean, display = preference.display) => {
    try {
      controller.save({ enabled, display });
      onMessage("已更新");
    } catch {
      onMessage(`无法保存${name}展示设置`);
    }
  };
  const update = (patch: Partial<PanelDisplayContribution>) =>
    save(preference.enabled, { ...preference.display, ...patch });
  return (
    <SettingsSection
      title={`${name}展示扩展`}
      desc="展示插件只改变外观和工具入口，文档及分栏仍由宿主管理。"
    >
      <>
        <div className="plugin-settings-grid">
          <section className="plugin-settings-group" aria-label="文字与行距">
            <h3>文字与行距</h3>
            <Field label={`${name}字体`} desc="">
              <select
                aria-label={`${name}字体`}
                value={preference.display.font}
                onChange={(event) =>
                  update({
                    font: event.target
                      .value as PanelDisplayContribution["font"],
                  })
                }
              >
                <option value="inherit">跟随风格</option>
                <option value="sans">无衬线</option>
                <option value="mono">等宽</option>
              </select>
            </Field>
            <Field label={`${name}字号`} desc="">
              <DisplayNumber
                label={`${name}字号`}
                min={12}
                max={20}
                value={preference.display.fontSize}
                onChange={(value) => update({ fontSize: value })}
              />{" "}
              px
            </Field>
            <Field label={`${name}行高`} desc="">
              <DisplayNumber
                label={`${name}行高`}
                min={28}
                max={48}
                value={preference.display.rowHeight}
                onChange={(value) => update({ rowHeight: value })}
              />{" "}
              px
            </Field>
            <Field
              label={
                outline
                  ? "标题颜色"
                  : bookmark
                    ? "书签名称颜色"
                    : "文档名称颜色"
              }
              desc="使用当前浅色或深色主题的语义配色；层次配色及当前标题高亮优先。"
            >
              <select
                aria-label={
                  outline
                    ? "标题颜色"
                    : bookmark
                      ? "书签名称颜色"
                      : "文档名称颜色"
                }
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
          </section>
          <section className="plugin-settings-group" aria-label="信息与工具">
            <h3>信息与工具</h3>
            <Field label="悬停提示" desc="">
              <select
                aria-label={`${name}悬停提示`}
                value={preference.display.tooltip}
                onChange={(event) =>
                  update({
                    tooltip: event.target
                      .value as PanelDisplayContribution["tooltip"],
                  })
                }
              >
                <option value="path">
                  {outline
                    ? "章节路径"
                    : bookmark
                      ? "名称与正文预览"
                      : "完整路径"}
                </option>
                <option value="name">名称</option>
              </select>
            </Field>
            <Field label="辅助信息" desc="">
              <label>
                <input
                  type="checkbox"
                  checked={preference.display.showCounts}
                  onChange={(event) =>
                    update({ showCounts: event.target.checked })
                  }
                />
                {outline
                  ? "目录标题数"
                  : bookmark
                    ? "书签数"
                    : notes
                      ? "分组文档数"
                      : "路径文档数"}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={preference.display.showMetadata}
                  onChange={(event) =>
                    update({ showMetadata: event.target.checked })
                  }
                />
                {outline
                  ? "标题级别（H1～H6）"
                  : bookmark
                    ? "对应块号"
                    : notes
                      ? "最近修改日期"
                      : "文档类型"}
              </label>
            </Field>
            {(bookmark || notes) && (
              <Field
                label="展示排序"
                desc="只改变列表顺序，不改写书签锚点、随记分组或文档属性。"
              >
                <select
                  aria-label={`${name}展示排序`}
                  value={preference.display.order ?? "host"}
                  onChange={(event) =>
                    update({
                      order: event.target
                        .value as PanelDisplayContribution["order"],
                    })
                  }
                >
                  <option value="host">
                    {bookmark ? "正文位置" : "默认（最近修改）"}
                  </option>
                  <option value="name">名称</option>
                  <option value="recent">
                    {bookmark ? "最近创建" : "最近修改"}
                  </option>
                </select>
              </Field>
            )}
            <Field label="扩展工具栏" desc="">
              <label>
                <input
                  type="checkbox"
                  checked={preference.display.toolbar.length > 0}
                  onChange={(event) =>
                    update({
                      toolbar: event.target.checked
                        ? controller.defaults.toolbar
                        : [],
                    })
                  }
                />
                {outline
                  ? "定位当前标题"
                  : bookmark
                    ? "定位当前书签"
                    : notes
                      ? "展开所有分组、刷新随记"
                      : "展开所有目录、刷新文档树"}
              </label>
            </Field>
          </section>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => save(preference.enabled, controller.defaults)}
        >
          恢复{name}展示默认设置
        </button>
      </>
    </SettingsSection>
  );
}
