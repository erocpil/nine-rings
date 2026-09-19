import assert from "node:assert/strict";
import type { AppConfig } from "../src/types/models";
import { saveEditorAppearance } from "../src/lib/save-editor-appearance";

const items = new Map<string, string>([["nr:blockWorkspaceDisplay", '{"tabSize":4}'], ["nr:codeBlockHeightPercent", "60"], ["nr:codeLineNumbers", "false"]]);
let failHeight = false;
let failLineNumbers = false;
const storage = {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (failHeight && key === "nr:codeBlockHeightPercent") { failHeight = false; throw new Error("storage failed"); }
    if (failLineNumbers && key === "nr:codeLineNumbers") { failLineNumbers = false; throw new Error("line numbers failed"); }
    items.set(key, value);
  },
  removeItem: (key: string) => { items.delete(key); },
};
Object.defineProperty(globalThis, "localStorage", { value: storage });
let notifications = 0;
Object.defineProperty(globalThis, "window", { value: { dispatchEvent: () => { notifications++; } } });
Object.defineProperty(globalThis, "document", { value: { documentElement: { style: { setProperty() {} } } } });
let config = { note_font_size: 16 } as AppConfig;
let failConfig = false;
const store = {
  get: async () => ({ ...config }),
  set: async (changes: Partial<AppConfig>) => {
    if (failConfig) throw new Error("database failed");
    config = { ...config, ...changes };
    return config;
  },
};
const display = { preferences: { tabSize: 8, lineNumbers: true }, height: 40 };
const initial = [...items];
failConfig = true;
await assert.rejects(saveEditorAppearance(store, { note_font_size: 20 }, display), /database failed/);
assert.deepEqual([...items], initial);
assert.equal(config.note_font_size, 16);
assert.equal(notifications, 0);
failConfig = false;
failHeight = true;
await assert.rejects(saveEditorAppearance(store, { note_font_size: 20 }, display), /storage failed/);
assert.deepEqual([...items], initial, "first local write must roll back when second fails");
assert.equal(config.note_font_size, 16, "database preferences must roll back too");
assert.equal(notifications, 0, "failed apply must not notify editors");
failLineNumbers = true;
await assert.rejects(saveEditorAppearance(store, { note_font_size: 20 }, display), /line numbers failed/);
assert.deepEqual([...items], initial, "line-number write failure must restore every display preference");
assert.equal(config.note_font_size, 16);
assert.equal(notifications, 0);
await saveEditorAppearance(store, { note_font_size: 20 }, display);
assert.equal(config.note_font_size, 20);
assert.equal(items.get("nr:blockWorkspaceDisplay"), '{"tabSize":8,"lineNumbers":true}');
assert.equal(items.get("nr:codeLineNumbers"), "true");
assert.equal(items.get("nr:codeBlockHeightPercent"), "40");
assert.equal(notifications, 2);
console.log("Editor appearance apply and rollback passed");
