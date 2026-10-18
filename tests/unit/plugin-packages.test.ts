import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { zipSync, strToU8 } from "fflate";
import { BUILTIN_THEME_RESOURCES } from "../../src/lib/plugin-system/builtin-theme-resources";
import {
  validatePluginPackage,
  readPluginArchive,
  safePackagePath,
  packageDigest,
  validatePackageUpdate,
  PACKAGE_LIMITS,
} from "../../src/lib/plugin-system/package-validation";
import {
  installPluginPackage,
  listPluginPackages,
  setPluginPackageEnabled,
  removePluginPackage,
} from "../../src/lib/plugin-system/package-store";
import { pluginRuntime } from "../../src/lib/plugin-system/runtime";
import { themeResources } from "../../src/lib/plugin-system/theme-resources";
import { startInstalledPluginPackages } from "../../src/lib/plugin-system/installed-packages";
import { pluginLifecycle } from "../../src/lib/plugin-system/lifecycle";
import { NUMBERING_PLUGIN_ID, DEFAULT_NUMBERING_DISPLAYS } from "../../src/lib/plugin-system/builtin-numbering-display";
import { DEFAULT_STATUS_DISPLAY, statusDisplays } from "../../src/lib/plugin-system/status-display";
import { STATUS_PLUGIN_ID } from "../../src/lib/plugin-system/builtin-status-display";
import { numberingDisplays } from "../../src/lib/plugin-system/numbering-display";

export async function packageFiles(
  version = "1.0.0",
  mutate?: (manifest: Record<string, unknown>) => void,
) {
  const resource = { ...BUILTIN_THEME_RESOURCES[0], id: "acme.palette/paper" };
  const data = strToU8(JSON.stringify(resource));
  const manifest: Record<string, unknown> = {
    manifestVersion: 1,
    id: "acme.palette",
    name: "测试配色",
    version,
    engines: { nineRingsPluginApi: "^0.1.0", app: "^0.3.0" },
    contributes: {
      themes: [
        { id: "paper", name: resource.name, resource: "resources/paper.json" },
      ],
    },
    integrity: {
      algorithm: "sha256",
      files: { "resources/paper.json": await packageDigest(data) },
    },
  };
  mutate?.(manifest);
  return {
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "resources/paper.json": data,
  };
}
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const events = new EventTarget();
  vi.stubGlobal("window", events);
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  pluginRuntime.setEnabled(false);
  vi.unstubAllGlobals();
});

it("accepts a bounded ZIP, verifies every resource and includes manifest bytes in the trust fingerprint", async () => {
  const files = await packageFiles();
  const validated = await validatePluginPackage(
    readPluginArchive(zipSync(files)),
  );
  expect(validated.themes[0].id).toBe("acme.palette/paper");
  expect(validated.digest).toHaveLength(64);
  const changed = await packageFiles("1.0.0", (manifest) => {
    manifest.description = "changed";
  });
  expect((await validatePluginPackage(changed)).digest).not.toBe(
    validated.digest,
  );
  const tampered = { ...files, "resources/paper.json": strToU8("{}") };
  await expect(validatePluginPackage(tampered)).rejects.toThrow("完整核验");
  await expect(
    validatePluginPackage({ ...files, "extra.json": strToU8("{}") }),
  ).rejects.toThrow();
});
it.each([
  "../manifest.json",
  "/manifest.json",
  "a/../b.json",
  "C:manifest.json",
  "a\\b.json",
  "a//b.json",
  "CON.json",
  "a./b.json",
  "%2e%2e/a.json",
  "ré.json",
])("rejects ambiguous or unsafe paths: %s", (path) => {
  expect(() => safePackagePath(path)).toThrow();
});
it("rejects case collisions, forged ZIP lengths, symlinks and inflation beyond the declared size", async () => {
  const files = await packageFiles();
  expect(() =>
    readPluginArchive(
      zipSync({ ...files, "MANIFEST.json": files["manifest.json"] }),
    ),
  ).toThrow("重复");
  expect(() =>
    readPluginArchive(new Uint8Array(PACKAGE_LIMITS.compressed + 1)),
  ).toThrow();
  const archive = zipSync(files),
    copy = () => new Uint8Array(archive);
  const view = new DataView(archive.buffer);
  const central = view.getUint32(archive.length - 6, true);
  const symbolic = copy();
  new DataView(symbolic.buffer).setUint32(central + 38, 0xa1ff0000, true);
  expect(() => readPluginArchive(symbolic)).toThrow();
  const lie = copy(),
    lieView = new DataView(lie.buffer);
  lieView.setUint32(central + 24, 1, true);
  lieView.setUint32(22, 1, true);
  expect(() => readPluginArchive(lie)).toThrow();
  const invalid = copy();
  invalid[0] = 0;
  expect(() => readPluginArchive(invalid)).toThrow();
});
it.each([
  (m: Record<string, unknown>) => {
    m.entry = "index.js";
  },
  (m: Record<string, unknown>) => {
    m.permissions = [];
  },
  (m: Record<string, unknown>) => {
    m.id = "nine-rings.fake";
  },
  (m: Record<string, unknown>) => {
    m.version = "1.0.0-01";
  },
  (m: Record<string, unknown>) => {
    m.engines = { nineRingsPluginApi: "not-a-range" };
  },
  (m: Record<string, unknown>) => {
    m.engines = { nineRingsPluginApi: "^8.0.0" };
  },
  (m: Record<string, unknown>) => {
    m.contributes = { macros: [] };
  },
  (m: Record<string, unknown>) => {
    delete m.integrity;
  },
])(
  "rejects code, reserved ownership, incompatible versions and unopened contributions",
  async (mutate) => {
    await expect(
      validatePluginPackage(await packageFiles("1.0.0", mutate)),
    ).rejects.toThrow();
  },
);
it("rejects duplicate JSON keys, unsafe theme tokens and ownership mismatch even with correct integrity", async () => {
  const files = await packageFiles();
  const duplicate = strToU8(
    new TextDecoder()
      .decode(files["manifest.json"])
      .replace(
        '"manifestVersion":1',
        '"manifestVersion":1,"manifestVersion":1',
      ),
  );
  await expect(
    validatePluginPackage({ ...files, "manifest.json": duplicate }),
  ).rejects.toThrow();
  for (const patch of [
    { css: "body{display:none}" },
    { id: "another.provider/paper" },
    { light: { bg: "url(https://evil.invalid/)" } },
  ]) {
    const resource = {
      ...BUILTIN_THEME_RESOURCES[0],
      id: "acme.palette/paper",
      ...patch,
    };
    const data = strToU8(JSON.stringify(resource));
    const manifest = JSON.parse(
      new TextDecoder().decode(files["manifest.json"]),
    );
    manifest.integrity.files["resources/paper.json"] =
      await packageDigest(data);
    await expect(
      validatePluginPackage({
        "manifest.json": strToU8(JSON.stringify(manifest)),
        "resources/paper.json": data,
      }),
    ).rejects.toThrow();
  }
});
it("requires explicit consent, commits disabled, checks concurrent updates and preserves missing selection on uninstall", async () => {
  const initial = await validatePluginPackage(await packageFiles());
  await expect(installPluginPackage(initial, null, false)).rejects.toThrow(
    "明确确认",
  );
  expect(await listPluginPackages()).toEqual([]);
  await installPluginPackage(initial, null, true);
  const [record] = await listPluginPackages();
  expect(record.enabled).toBe(false);
  expect(record.trustedDigest).toBe(initial.digest);
  await setPluginPackageEnabled(record, true);
  expect((await listPluginPackages())[0].enabled).toBe(true);
  const update = await validatePluginPackage(await packageFiles("1.1.0"));
  await expect(installPluginPackage(update, null, true)).rejects.toThrow(
    "其它窗口",
  );
  await installPluginPackage(update, initial.digest, true);
  expect((await listPluginPackages())[0]).toMatchObject({
    enabled: false,
    version: "1.1.0",
  });
  await expect(removePluginPackage(record)).rejects.toThrow("其它窗口");
  await removePluginPackage((await listPluginPackages())[0]);
  expect(await listPluginPackages()).toEqual([]);
  expect(() => validatePackageUpdate("1.0.0", "1.0.0-beta.2")).toThrow();
  expect(() => validatePackageUpdate("1.0.0", "1.0.0")).toThrow();
  expect(() => validatePackageUpdate("1.0.0-beta.1", "1.0.0")).not.toThrow();
});
it("activates only verified trusted resources, revokes on disable/global stop and revalidates after reload", async () => {
  const initial = await validatePluginPackage(await packageFiles());
  await installPluginPackage(initial, null, true);
  let [record] = await listPluginPackages();
  pluginRuntime.setEnabled(true);
  stop = startInstalledPluginPackages();
  await setPluginPackageEnabled(record, true);
  await vi.waitFor(() =>
    expect(themeResources.get("acme.palette/paper")).not.toBeNull(),
  );
  await setPluginPackageEnabled(record, false);
  await vi.waitFor(() =>
    expect(themeResources.get("acme.palette/paper")).toBeNull(),
  );
  await setPluginPackageEnabled(record, true);
  await vi.waitFor(() =>
    expect(themeResources.get("acme.palette/paper")).not.toBeNull(),
  );
  pluginRuntime.setEnabled(false);
  expect(themeResources.get("acme.palette/paper")).toBeNull();
  stop();
  stop = undefined;
  pluginRuntime.setEnabled(true);
  stop = startInstalledPluginPackages();
  await vi.waitFor(() =>
    expect(themeResources.get("acme.palette/paper")).not.toBeNull(),
  );
  [record] = await listPluginPackages();
  await removePluginPackage(record);
  await vi.waitFor(() =>
    expect(themeResources.get("acme.palette/paper")).toBeNull(),
  );
});

it("lets an enabled declarative reading-display package take over active built-in displays", async () => {
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(
    readFileSync("schema/plugin/examples/erocpil.reading-display/manifest.json", "utf8"),
  );
  manifest.integrity = { algorithm: "sha256", files: {} };
  const files = { "manifest.json": strToU8(JSON.stringify(manifest)) };
  const reading = await validatePluginPackage(files);
  await installPluginPackage(reading, null, true);
  pluginRuntime.setEnabled(true);
  await pluginLifecycle.activate(NUMBERING_PLUGIN_ID, [], {
    activate(owner) {
      numberingDisplays.register(owner.activation, DEFAULT_NUMBERING_DISPLAYS);
    },
  });
  await pluginLifecycle.activate(STATUS_PLUGIN_ID, [], {
    activate(owner) {
      statusDisplays.register(owner.activation, DEFAULT_STATUS_DISPLAY);
    },
  });
  stop = startInstalledPluginPackages();
  await setPluginPackageEnabled((await listPluginPackages())[0], true);
  await vi.waitFor(() =>
    expect(pluginRuntime.getStatus().activations.some((entry) => entry.pluginId === reading.id)).toBe(true),
  );
  const activeIds = pluginRuntime.getStatus().activations.map((entry) => entry.pluginId);
  expect(activeIds).toContain(reading.id);
  expect(activeIds).not.toContain(NUMBERING_PLUGIN_ID);
  expect(activeIds).not.toContain(STATUS_PLUGIN_ID);
  expect(statusDisplays.getSnapshot()?.fontSize).toBe(12);
  expect(numberingDisplays.getSnapshot().blocks?.fontSize).toBe(13);
});

it("rejects stored byte tampering on the next activation even if enabled/trust metadata was restored", async () => {
  const initial = await validatePluginPackage(await packageFiles());
  await installPluginPackage(initial, null, true);
  const [record] = await listPluginPackages();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("nine-rings-plugin-packages");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("packages", "readwrite");
    tx.objectStore("packages").put({
      ...record,
      enabled: true,
      files: { ...record.files, "resources/paper.json": "{}" },
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  pluginRuntime.setEnabled(true);
  stop = startInstalledPluginPackages();
  await vi.waitFor(() =>
    expect(pluginRuntime.getStatus().lastFailure).toMatchObject({
      pluginId: record.id,
      code: "INVALID_ARGUMENT",
    }),
  );
  expect(themeResources.get("acme.palette/paper")).toBeNull();
});
it("checks manifest platforms against the actual host", async () => {
  const files = await packageFiles("1.0.0", (manifest) => {
    manifest.platforms = ["web"];
  });
  await expect(validatePluginPackage(files)).resolves.toMatchObject({
    id: "acme.palette",
  });
  Object.assign(window, { isTauri: true });
  await expect(validatePluginPackage(files)).rejects.toThrow("当前平台");
});

it("packs the documented example in a real Node ESM process without a runtime compiler", async () => {
  const { mkdtempSync, rmSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "nr-plugin-pack-"));
  try {
    const destination = join(directory, "example.nrplugin.zip");
    const args = [
      "--import",
      "tsx",
      "scripts/pack-plugin.ts",
      "schema/plugin/examples/acme.paired-theme",
      destination,
    ];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const bytes = readFileSync(destination);
    expect((await validatePluginPackage(readPluginArchive(bytes))).id).toBe(
      "acme.paired-theme",
    );
    expect(spawnSync(process.execPath, args).status).not.toBe(0);
    expect(readFileSync(destination)).toEqual(bytes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("an older host cleanup cannot revoke a newer activation of the same package", async () => {
  const initial = await validatePluginPackage(await packageFiles());
  await installPluginPackage(initial, null, true);
  await setPluginPackageEnabled((await listPluginPackages())[0], true);
  pluginRuntime.setEnabled(true);
  const first = startInstalledPluginPackages();
  stop = first;
  const generation = () =>
    pluginRuntime
      .getStatus()
      .activations.find((row) => row.pluginId === initial.id)?.generation;
  await vi.waitFor(() => expect(generation()).toBeDefined());
  const original = generation();
  const { pluginLifecycle } =
    await import("../../src/lib/plugin-system/lifecycle");
  await pluginLifecycle.deactivate(initial.id);
  const second = startInstalledPluginPackages();
  stop = second;
  await vi.waitFor(() => {
    expect(generation()).toBeDefined();
    expect(generation()).not.toBe(original);
  });
  first();
  expect(themeResources.get("acme.palette/paper")).not.toBeNull();
});

it("maps desktop manifest platforms to Tauri and keeps web exclusion", async () => {
  const files = await packageFiles("1.0.0", (manifest) => {
    manifest.platforms = ["desktop"];
  });
  await expect(
    validatePluginPackage(files, "0.3.0", "tauri"),
  ).resolves.toMatchObject({ id: "acme.palette" });
  await expect(validatePluginPackage(files, "0.3.0", "web")).rejects.toThrow(
    "当前平台",
  );
  const both = await packageFiles("1.0.0", (manifest) => {
    manifest.platforms = ["desktop", "web"];
  });
  await expect(
    validatePluginPackage(both, "0.3.0", "tauri"),
  ).resolves.toMatchObject({ id: "acme.palette" });
  await expect(
    validatePluginPackage(both, "0.3.0", "web"),
  ).resolves.toMatchObject({ id: "acme.palette" });
});

it("packs a desktop-only reading preset and rejects it on web", async () => {
  const { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "nr-reading-pack-"));
  try {
    const source = join(directory, "source");
    mkdirSync(source);
    const manifest = JSON.parse(
      readFileSync(
        "schema/plugin/examples/erocpil.reading-display/manifest.json",
        "utf8",
      ),
    );
    manifest.platforms = ["desktop"];
    writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest));
    const output = join(directory, "reading.nrplugin.zip");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/pack-plugin.ts", source, output],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const files = readPluginArchive(readFileSync(output));
    const parsed = await validatePluginPackage(files, "0.3.0", "tauri");
    expect(parsed.id).toBe("erocpil.reading-display");
    expect(parsed.gutters).toHaveLength(2);
    expect(parsed.statusBar?.items.slice(-3)).toEqual([
      "navigation",
      "diagnostics",
      "history",
    ]);
    await expect(validatePluginPackage(files, "0.3.0", "web")).rejects.toThrow(
      "当前平台",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
