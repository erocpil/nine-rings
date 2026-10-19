import assert from "node:assert/strict";
import {
  BLOCK_MENU_GROUPS,
  DEFAULT_BLOCK_MENU_PRESENTATION,
  blockMenuTitle,
  readBlockMenuPresentation,
  saveBlockMenuPresentation,
} from "../src/lib/plugin-system/builtin-block-menu";
import { groupBlockMenuActions, type BlockMenuAction } from "../src/components/BlockActionMenu";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
};
(globalThis as unknown as { window: unknown }).window = { dispatchEvent: () => true };

assert.equal(blockMenuTitle(DEFAULT_BLOCK_MENU_PRESENTATION, 4, "blockquote"), "第 4 块 · 引用");
assert.equal(blockMenuTitle({ ...DEFAULT_BLOCK_MENU_PRESENTATION, title: "type" }, 4, "codeBlock"), "块操作 · 代码");

const actions: BlockMenuAction[] = [
  { label: "复制内容", run: () => {} },
  { label: "文字颜色", run: () => {} },
  { label: "删除此块", run: () => {}, danger: true },
  { label: "未来宿主操作", run: () => {} },
];
const reordered = groupBlockMenuActions(actions, {
  ...DEFAULT_BLOCK_MENU_PRESENTATION,
  groupOrder: ["remove", "copy", "reading", "block", "style", "structure", "selection"],
  visibleGroups: ["remove", "copy", "style"],
});
assert.deepEqual(reordered.map(action => [action.label, action.group]), [
  ["删除此块", "剪切与删除"],
  ["复制内容", "复制与引用"],
  ["文字颜色", "文字样式"],
  ["未来宿主操作", undefined],
]);
assert.equal(readBlockMenuPresentation().enabled, true);
saveBlockMenuPresentation({
  ...DEFAULT_BLOCK_MENU_PRESENTATION,
  title: "type",
  visibleGroups: BLOCK_MENU_GROUPS.filter(item => item.id !== "remove").map(item => item.id),
});
assert.equal(readBlockMenuPresentation().title, "type");
assert.throws(() => saveBlockMenuPresentation({ ...DEFAULT_BLOCK_MENU_PRESENTATION, fontSize: 99 }));
const safeFallback = groupBlockMenuActions(actions, { ...DEFAULT_BLOCK_MENU_PRESENTATION, visibleGroups: [] });
assert.ok(safeFallback.some(action => action.label === "删除此块"));
console.log("block menu plugin presentation tests passed");
