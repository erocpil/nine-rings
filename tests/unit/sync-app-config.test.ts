import sharedConfig from "../../schema/sync/fixtures/app-config-v1.json";
import {
  CERTIFIED_WEB_CONFIG_KEYS,
  isCertifiedWebAppConfig,
} from "../../src/lib/sync/app-config-policy";
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/lib/storage/types";
import { getConfig, setConfig } from "../../src/lib/storage/db-config";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import { candidateEntities } from "../../src/lib/sync/entity-projection";
import { assembleEntityCandidate } from "../../src/lib/sync/entity-assembly";
import { entityKey } from "../../src/lib/sync/entity-plan";
import { CURRENT_SYNC_CAPABILITIES } from "../../src/lib/sync/protocol-capabilities";

const config = () => structuredClone(DEFAULT_CONFIG);
const source = (value: unknown) =>
  JSON.stringify({ version: 1, notes: [], config: value });
const review = (value: unknown) => reviewCandidatePayload(source(value), "web");
afterEach(() => vi.unstubAllGlobals());
it("requires explicit certification review when the AppConfig field set changes", () => {
  expect([...CERTIFIED_WEB_CONFIG_KEYS].sort()).toEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
  );
});

it("certifies complete Web/Tauri configuration without user storage access and keeps Flutter closed", () => {
  vi.stubGlobal(
    "localStorage",
    new Proxy(
      {},
      {
        get() {
          throw Error("must not access real storage");
        },
      },
    ),
  );
  expect(review(config())).toMatchObject({
    eligible: true,
    requiredFeatures: expect.arrayContaining(["app-config-v1"]),
  });
  for (const runtime of ["flutter"] as const) {
    expect(
      reviewCandidatePayload(source(config()), runtime).issues[
        "runtime-unsupported"
      ],
    ).toBeTruthy();
  }
  expect(reviewCandidatePayload(source(config()), "tauri").eligible).toBe(true);
  expect(CURRENT_SYNC_CAPABILITIES.write).toBe(1);
});

it("requires all known fields, rejects unknown fields, malformed values and lossy migrations", () => {
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const incomplete = config() as unknown as Record<string, unknown>;
    delete incomplete[key];
    expect(review(incomplete).eligible, key).toBe(
      key === "editor_fold_icon_overrides",
    );
  }
  const invalid = [
    { unknown: true },
    { interface_style: "obsolete" },
    { interface_font_family: "arbitrary" },
    { editor_code_font_family: "arbitrary" },
    { interface_color_mode: "auto" },
    { editor_outline_fold_icon_style: "unknown" },
    {
      editor_fold_icon_overrides: {
        heading: { style: "custom", collapsed: "123456789" },
      },
    },
    { editor_fold_icon_overrides: { unexpected: { style: "triangle" } } },
    { highlight_active_line: "true" },
    { interface_font_size: "16" },
    { navigation_tree_text_color: "url(secret)" },
    { hierarchy_path_custom_colors: ["#123456"] },
    { hotkeys: { token: "private" } },
    { hotkeys: { focus_search: 12 } },
    {
      hierarchy_path_custom_colors: [
        "#9A5B00",
        "#B0473C",
        "#5E7C36",
        "#247F7B",
        "#5266A8",
        "#8356A1",
      ],
    },
  ];
  for (const partial of invalid)
    expect(review({ ...config(), ...partial }).eligible).toBe(false);
});

it("accepts a complete app-config-v1 backup from before per-location fold markers", () => {
  const legacy = config() as unknown as Record<string, unknown>;
  delete legacy.editor_fold_icon_overrides;
  expect(review(legacy)).toMatchObject({ eligible: true });
  expect(isCertifiedWebAppConfig(legacy)).toBe(true);
});

it("round-trips a complete customized config through actual import, storage, read, edit and export", async () => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  });
  const input = config();
  input.interface_style = "paper";
  input.interface_color_mode = "dark";
  input.editor_code_font_family = "monospace";
  input.interface_font_size = 20;
  input.editor_outline_fold_icon_style = null;
  input.user_name = "作者 α";
  input.hotkeys = { focus_search: "Alt+F", show_window: "Alt+Y" };
  input.hierarchy_path_custom_colors = Array(6).fill("#aabbcc");
  input.navigation_tree_text_color = "#123456";
  await setConfig({
    editor_outline_fold_icon_style: "chevron",
    user_name: "原作者",
    interface_font_size: 18,
  });
  await importData(source(input), "replace");
  expect(await getConfig()).toEqual(input);
  const exported = await exportData();
  expect(reviewCandidatePayload(exported, "web").eligible).toBe(true);
  expect(JSON.parse(exported).config).toEqual(input);
  await setConfig({ interface_font_size: 21 });
  const edited = JSON.parse(await exportData());
  expect(edited.config).toEqual({ ...input, interface_font_size: 21 });
  expect(reviewCandidatePayload(JSON.stringify(edited), "web").eligible).toBe(
    true,
  );
  expect(
    (await candidateEntities(exported, "web")).find(
      (entity) => entity.id === "app-config",
    )?.value,
  ).toEqual(input);
});

it("keeps AppConfig and frontend settings separate through conflict choice and candidate assembly", async () => {
  const localConfig = { ...config(), interface_font_size: 22 };
  const localSource = source(localConfig);
  const remoteSource = JSON.stringify({
    version: 1,
    notes: [],
    config: config(),
    user_settings: { version: 1, values: { "nr:focusMode": true } },
  });
  const local = await candidateEntities(localSource, "web");
  const remote = await candidateEntities(remoteSource, "web");
  const key = entityKey(local[0]);
  const unresolved = await assembleEntityCandidate({
    spaceId: "a".repeat(64),
    localSource,
    remoteSource,
    runtime: "web",
    baselines: [],
  });
  expect(JSON.parse(unresolved.source).config).toEqual(config());
  const assembled = await assembleEntityCandidate({
    spaceId: "a".repeat(64),
    localSource,
    remoteSource,
    runtime: "web",
    baselines: [],
    choices: [
      {
        key,
        action: "local",
        localHash: local[0].sha256,
        remoteHash: remote.find((e) => e.id === "app-config")!.sha256,
      },
    ],
  });
  expect(JSON.parse(assembled.source).config).toEqual(localConfig);
  expect(JSON.parse(assembled.source).user_settings).toEqual({
    version: 1,
    values: { "nr:focusMode": true },
  });
  expect(assembled.writable).toBe(false);
  expect(assembled.planSha256).not.toBe(unresolved.planSha256);
});

it("uses the same full configuration fixture as native file and backup tests", async () => {
  expect(Object.keys(sharedConfig).sort()).toEqual(
    [...CERTIFIED_WEB_CONFIG_KEYS].sort(),
  );
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  });
  await setConfig({
    editor_outline_fold_icon_style: "triangle",
    navigation_tree_font_size: 14,
  });
  await importData(source(sharedConfig), "replace");
  expect(JSON.parse(await exportData()).config).toEqual(sharedConfig);

  for (const runtime of ["web", "tauri"] as const) {
    expect(reviewCandidatePayload(source(sharedConfig), runtime).eligible).toBe(
      true,
    );
  }
  expect(await candidateEntities(source(sharedConfig), "web")).toEqual(
    await candidateEntities(source(sharedConfig), "tauri"),
  );
});

it("rejects native integer overflow, fractions and unpaired UTF-16 before applying configuration", () => {
  for (const patch of [
    { navigation_font_size: 14.5 },
    { interface_font_size: 2147483648 },
    { user_name: "\ud800" },
    { user_name: "\udc00" },
    { hotkeys: { "\ud800": "Alt+Q" } },
  ]) {
    expect(
      reviewCandidatePayload(source({ ...config(), ...patch }), "tauri")
        .eligible,
    ).toBe(false);
  }
  expect(
    reviewCandidatePayload(
      source({ ...config(), user_name: "𠮷 📚", editor_line_height: 1.75 }),
      "tauri",
    ).eligible,
  ).toBe(true);
});

it("retires only removed local preferences while refusing the original remote configuration", async () => {
  const legacy = {
    ...config(),
    default_view: "notes",
    todo_carryover_default: true,
  };
  const original = source(legacy);
  expect(review(legacy).issues["settings-not-certified"]).toBe(1);
  await expect(candidateEntities(original, "web")).rejects.toThrow(
    "default_view、todo_carryover_default",
  );
  const values = new Map<string, string>([
    ["nine_rings_config", JSON.stringify(legacy)],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  const current = await getConfig();
  expect(current).not.toHaveProperty("default_view");
  expect(current).not.toHaveProperty("todo_carryover_default");
  expect(review(current).eligible).toBe(true);
  await setConfig(legacy);
  expect(JSON.parse(values.get("nine_rings_config")!)).not.toHaveProperty(
    "default_view",
  );
  expect(source(legacy)).toBe(original);
  await setConfig({
    ...config(),
    future_user_setting: "preserve",
  } as typeof legacy);
  expect(await getConfig()).toHaveProperty("future_user_setting", "preserve");
  expect(review(await getConfig()).eligible).toBe(false);
});
