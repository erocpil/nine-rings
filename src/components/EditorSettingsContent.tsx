import type { ReactNode } from "react";
import type { AppConfig } from "../types/models";
import { useNumberingDisplay } from "../hooks/useNumberingDisplay";
import { useRelativeNumbering } from "../hooks/useRelativeNumbering";
import { useStatusBarDisplay } from "../hooks/useStatusBarDisplay";
import { saveBlockWorkspacePreferences } from "../lib/block-display-settings";
import { Field } from "./SettingsFields";
import { SettingsFoldIcons } from "./SettingsFoldIcons";

export function EditorSettingsContent({ config, update, openAppearance, palette }: {
  config: AppConfig;
  update: (patch: Partial<AppConfig>) => void;
  openAppearance: () => void;
  palette?: ReactNode;
}) {
  const numberingPlugins = useNumberingDisplay();
  const relativeNumbering = useRelativeNumbering();
  const statusBarPreference = useStatusBarDisplay(false);
  const statusPlugin = statusBarPreference.display;

  return <>
    {palette && <Field label="配色" desc="应用于 File Workbench 的编辑与文件浏览窗口">{palette}</Field>}
    <Field label="编辑器排版" desc="集中调整字体、行距、缩进和搜索高亮">
      <button
        className="editor-appearance-entry"
        type="button"
        onClick={openAppearance}
      >
        <span>
          <strong>{config.interface_style === "classic" ? `${config.note_font_size}px` : `${config.interface_font_size}px`}</strong>
          <small>{config.interface_style === "classic" ? `${config.editor_font_family === "system" ? "系统字体" : config.editor_font_family} · ${config.editor_line_height.toFixed(1)} 行距` : `非经典风格排版 · ${config.interface_line_height.toFixed(1)} 行距`}</small>
        </span>
        <span className="editor-appearance-entry-action">打开排版设置 →</span>
      </button>
    </Field>

    {/* ── 高亮当前行 ── */}
    <Field label="高亮当前行" desc="正文与 Markdown 源码中，光标所在行显示浅色背景">
      <label className="settings-toggle editor-settings-toggle">
        <input
          type="checkbox"
          aria-label="高亮当前行" checked={config.highlight_active_line}
          onChange={(e) => update({ highlight_active_line: e.target.checked })}
        />
        <span className="toggle-track" />
        <span className="toggle-label">{config.highlight_active_line ? "开" : "关"}</span>
      </label>
    </Field>

    {(numberingPlugins.blocks || numberingPlugins.source) && <p className="settings-desc" role="status">编号展示由插件接管；对应内置设置暂时禁用，停用插件后恢复原值。</p>}
    {/* ── 显示块编号 ── */}
    <Field label="显示块编号" desc="正文按顶层内容块编号；Markdown 源码按文本行显示行号">
      <label className="settings-toggle editor-settings-toggle">
        <input
          type="checkbox"
          aria-label="显示块编号" disabled={Boolean(numberingPlugins.blocks || numberingPlugins.source)} checked={config.editor_show_line_numbers}
          onChange={(e) => update({ editor_show_line_numbers: e.target.checked })}
        />
        <span className="toggle-track" />
        <span className="toggle-label">{config.editor_show_line_numbers ? "开" : "关"}</span>
      </label>
    </Field>

    <Field label="相对块号" desc="当前块显示绝对块号，其余显示可见块距离；需开启显示块编号，折叠隐藏的块不计数">
      <label className="settings-toggle editor-settings-toggle">
        <input type="checkbox" aria-label="相对块号" disabled={Boolean(numberingPlugins.blocks) || !config.editor_show_line_numbers} checked={relativeNumbering.relativeBlockNumbers} onChange={event => saveBlockWorkspacePreferences({ relativeBlockNumbers: event.target.checked })} />
        <span className="toggle-track" /><span className="toggle-label">{relativeNumbering.relativeBlockNumbers ? "开" : "关"}</span>
      </label>
    </Field>
    <Field label="相对行号" desc="Markdown 源码当前行显示绝对行号，其余显示可见行距；需开启显示块编号，折叠隐藏行和软换行不另计行数">
      <label className="settings-toggle editor-settings-toggle">
        <input type="checkbox" aria-label="相对行号" disabled={Boolean(numberingPlugins.source) || !config.editor_show_line_numbers} checked={relativeNumbering.relativeSourceLineNumbers} onChange={event => saveBlockWorkspacePreferences({ relativeSourceLineNumbers: event.target.checked })} />
        <span className="toggle-track" /><span className="toggle-label">{relativeNumbering.relativeSourceLineNumbers ? "开" : "关"}</span>
      </label>
    </Field>

    <Field label="相对块号当前项对齐" desc="仅在相对块号开启时生效，默认右对齐；其它编号仍右对齐">
      <select aria-label="相对块号当前项对齐" disabled={Boolean(numberingPlugins.blocks) || !config.editor_show_line_numbers || !relativeNumbering.relativeBlockNumbers} value={relativeNumbering.relativeBlockNumberAlignment} onChange={event => saveBlockWorkspacePreferences({ relativeBlockNumberAlignment: event.target.value as "left" | "right" })}>
        <option value="left">左对齐</option><option value="right">右对齐</option>
      </select>
    </Field>
    <Field label="相对行号当前项对齐" desc="仅在相对行号开启时生效，默认左对齐；其它编号仍右对齐">
      <select aria-label="相对行号当前项对齐" disabled={Boolean(numberingPlugins.source) || !config.editor_show_line_numbers || !relativeNumbering.relativeSourceLineNumbers} value={relativeNumbering.relativeSourceLineNumberAlignment} onChange={event => saveBlockWorkspacePreferences({ relativeSourceLineNumberAlignment: event.target.value as "left" | "right" })}>
        <option value="left">左对齐</option><option value="right">右对齐</option>
      </select>
    </Field>
    <Field label="源码折叠图标" desc="控制源码左侧折叠图标是否显示；隐藏图标会保留正文折叠状态，与源码状态栏同步">
      <label className="settings-toggle editor-settings-toggle">
        <input type="checkbox" aria-label="显示源码折叠图标" checked={relativeNumbering.sourceFoldGutter} onChange={event => saveBlockWorkspacePreferences({ sourceFoldGutter: event.target.checked })} />
        <span className="toggle-track" /><span className="toggle-label">{relativeNumbering.sourceFoldGutter ? "开" : "关"}</span>
      </label>
    </Field>
    <Field label="源码折叠连接线样式" desc="悬停成对折叠图标时显示实线、虚线或点线；不显示仍保留层级颜色和折叠操作">
      <select aria-label="源码折叠连接线样式" disabled={!relativeNumbering.sourceFoldGutter} value={relativeNumbering.sourceFoldConnectorStyle} onChange={event => saveBlockWorkspacePreferences({ sourceFoldConnectorStyle: event.target.value as "solid" | "dashed" | "dotted" | "none" })}>
        <option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option><option value="none">不显示</option>
      </select>
    </Field>
    <Field label="源码折叠连接线宽度" desc="设置连接线宽度；仅影响悬停提示，不改变 gutter 或正文布局">
      <select aria-label="源码折叠连接线宽度" disabled={!relativeNumbering.sourceFoldGutter || relativeNumbering.sourceFoldConnectorStyle === "none"} value={relativeNumbering.sourceFoldConnectorWidth} onChange={event => saveBlockWorkspacePreferences({ sourceFoldConnectorWidth: Number(event.target.value) as 1 | 2 | 3 | 4 })}>
        <option value="1">1px</option><option value="2">2px</option><option value="3">3px</option><option value="4">4px</option>
      </select>
    </Field>
    <Field label="源码折叠连接线透明度" desc="调整连接线相对层级色的透明程度">
      <select aria-label="源码折叠连接线透明度" disabled={!relativeNumbering.sourceFoldGutter || relativeNumbering.sourceFoldConnectorStyle === "none"} value={relativeNumbering.sourceFoldConnectorOpacity} onChange={event => saveBlockWorkspacePreferences({ sourceFoldConnectorOpacity: Number(event.target.value) as 25 | 50 | 75 | 100 })}>
        <option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option>
      </select>
    </Field>
    <Field label="状态栏块号" desc={config.editor_show_status_bar ? "显示光标所在的绝对块编号；相对编号不改变跳转或操作目标" : "请先开启状态栏；此选项的当前设置会保留"}>
      <label className="settings-toggle editor-settings-toggle">
        <input
          type="checkbox"
          aria-label="状态栏块号" checked={config.editor_show_status_block_number}
          disabled={Boolean(statusPlugin) || !config.editor_show_status_bar}
          onChange={(e) => update({ editor_show_status_block_number: e.target.checked })}
        />
        <span className="toggle-track" />
        <span className="toggle-label">{config.editor_show_status_block_number ? "开" : "关"}</span>
      </label>
    </Field>

    <Field label="编辑器状态栏" desc="渲染与源码模式显示底部位置、字数和保存状态；关闭后搜索导航仍会按需出现">
      <label className="settings-toggle editor-settings-toggle">
        <input
          type="checkbox"
          aria-label="编辑器状态栏" disabled={Boolean(statusPlugin)} checked={config.editor_show_status_bar}
          onChange={(e) => update({ editor_show_status_bar: e.target.checked })}
        />
        <span className="toggle-track" />
        <span className="toggle-label">{config.editor_show_status_bar ? "开" : "关"}</span>
      </label>
    </Field>

    <Field label="显示总行数与总块数" desc={statusPlugin ? "由状态栏展示插件接管；停用插件后恢复此处保存的选择" : "合并到当前位置，例如 Ln 80/320 或 Block 8/45；包含折叠内容，默认显示"}>
      <label className="settings-toggle editor-settings-toggle">
        <input type="checkbox" aria-label="状态栏显示总行数与总块数" disabled={Boolean(statusPlugin) || !config.editor_show_status_bar} checked={statusBarPreference.showTotals} onChange={event => saveBlockWorkspacePreferences({ statusBarTotals: event.target.checked })} />
        <span className="toggle-track" /><span className="toggle-label">{statusBarPreference.showTotals ? "显示" : "隐藏"}</span>
      </label>
    </Field>

    {/* ── 正文右键菜单 ── */}
    <Field label="正文右键菜单" desc="开启后正文编辑器使用软件自带菜单，关闭则使用系统原生菜单">
      <label className="settings-toggle editor-settings-toggle">
        <input
          type="checkbox"
          aria-label="正文右键菜单" checked={config.use_custom_context_menu}
          onChange={(e) => update({ use_custom_context_menu: e.target.checked })}
        />
        <span className="toggle-track" />
        <span className="toggle-label">{config.use_custom_context_menu ? "软件菜单" : "原生菜单"}</span>
      </label>
    </Field>

    <Field label="折叠标识" desc="设置通用标识，也可展开分位置设置文本区标题、代码／引用块和文档目录；即时生效，不修改正文">
      <SettingsFoldIcons config={config} onChange={update} />
    </Field>

  </>;
}
