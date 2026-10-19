import { Field } from "./SettingsFields";
import {
  BLOCK_MENU_GROUPS,
  readBlockMenuPresentation,
  saveBlockMenuPresentation,
  type BlockMenuGroupId,
  type BlockMenuPresentation,
} from "../lib/plugin-system/builtin-block-menu";
import { useSyncExternalStore } from "react";
import {
  blockMenuPresentationSnapshot,
  subscribeBlockMenuPresentation,
} from "../lib/plugin-system/builtin-block-menu";

export function SettingsBlockMenuDisplay({ onMessage }: { onMessage: (message: string) => void }) {
  useSyncExternalStore(subscribeBlockMenuPresentation, blockMenuPresentationSnapshot);
  const preference = readBlockMenuPresentation();
  const update = (patch: Partial<BlockMenuPresentation>) => {
    try {
      saveBlockMenuPresentation({ ...preference, ...patch });
      onMessage("已更新");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "保存失败");
    }
  };
  const move = (id: BlockMenuGroupId, direction: -1 | 1) => {
    const index = preference.groupOrder.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= preference.groupOrder.length) return;
    const groupOrder = [...preference.groupOrder];
    [groupOrder[index], groupOrder[target]] = [groupOrder[target], groupOrder[index]];
    update({ groupOrder });
  };
  return <div className="plugin-settings-grid block-menu-settings-grid">
    <section className="plugin-settings-group" aria-label="菜单外观">
      <h3>菜单外观</h3>
      <Field label="菜单标题" desc="标题由当前块序号与类型生成，不读取或修改文档内容。">
      <select aria-label="菜单标题" value={preference.title} onChange={event => update({ title: event.target.value as BlockMenuPresentation["title"] })}>
        <option value="number-type">第 N 块 · 类型</option>
        <option value="type">块操作 · 类型</option>
      </select>
      </Field>
      <Field label="菜单字体" desc="使用受限字体选项，跟随主题的布局与对比度。">
      <select aria-label="菜单字体" value={preference.font} onChange={event => update({ font: event.target.value as BlockMenuPresentation["font"] })}>
        <option value="inherit">继承界面</option><option value="system">系统字体</option><option value="monospace">等宽字体</option>
      </select>
      </Field>
      <Field label="标题字号" desc="11–18 px；菜单正文仍沿用界面字号，避免破坏触控目标尺寸。">
      <select aria-label="标题字号" value={preference.fontSize} onChange={event => update({ fontSize: Number(event.target.value) })}>
        {[11, 12, 13, 14, 15, 16, 17, 18].map(size => <option key={size} value={size}>{size} px</option>)}
      </select>
      </Field>
      <Field label="标题加粗" desc="仅加粗菜单标题。"><input type="checkbox" checked={preference.boldTitle} aria-label="标题加粗" onChange={event => update({ boldTitle: event.target.checked })} /></Field>
      <Field label="悬停提示" desc="在桌面鼠标悬停菜单项时显示简短操作说明；触屏与键盘操作不受影响。"><input type="checkbox" checked={preference.showHints} aria-label="悬停提示" onChange={event => update({ showHints: event.target.checked })} /></Field>
      <Field label="标题颜色" desc="只使用主题文字、强调色和次要文字颜色，随浅色或深色主题自动适配。">
      <select aria-label="标题颜色" value={preference.color} onChange={event => update({ color: event.target.value as BlockMenuPresentation["color"] })}>
        <option value="secondary">次要文字</option><option value="theme">正文颜色</option><option value="accent">主题强调色</option>
      </select>
      </Field>
    </section>
    <section className="plugin-settings-group" aria-label="分组与操作">
      <h3>分组与操作</h3>
      <Field label="菜单分组" desc="关闭某组会隐藏该组的菜单项；宿主始终保留可用的菜单和编辑安全检查。">
        <div className="block-menu-plugin-groups">
        {preference.groupOrder.map((id, index) => {
          const group = BLOCK_MENU_GROUPS.find(item => item.id === id)!;
          return <div key={group.id} className="block-menu-plugin-group-row">
          <label><input type="checkbox" checked={preference.visibleGroups.includes(group.id)} aria-label={`显示${group.label}`} onChange={event => update({ visibleGroups: event.target.checked ? [...preference.visibleGroups, group.id] : preference.visibleGroups.filter(id => id !== group.id) })} />{group.label}</label>
          <span className="block-menu-plugin-reorder">
            <button type="button" aria-label={`${group.label}上移`} disabled={index === 0} onClick={() => move(group.id, -1)}>↑</button>
            <button type="button" aria-label={`${group.label}下移`} disabled={index === preference.groupOrder.length - 1} onClick={() => move(group.id, 1)}>↓</button>
          </span>
        </div>;
        })}
        </div>
      </Field>
    </section>
    <p className="settings-desc block-menu-settings-note">块菜单插件只负责展示策略。复制、格式、粘贴、剪切、删除、折叠和书签仍由 Nine Rings 宿主根据当前文档、只读状态和有效目标执行。</p>
  </div>;
}
