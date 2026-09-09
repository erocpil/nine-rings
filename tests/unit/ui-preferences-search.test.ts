import { describe, expect, it } from "vitest";
import {
  normalizeDocumentBrowserPreferences,
  readDocumentBrowserPreferences,
  saveDocumentBrowserPreferences,
} from "../../src/lib/document-browser-preferences";
import { searchSettings } from "../../src/lib/settings-search";

describe("document browser presentation preferences", () => {
  it("validates fields and ignores all private metadata", () => {
    const value = {
      sort: "title",
      sortDirection: "desc",
      view: "all",
      fields: { path: false, tags: true, type: true, modified: true },
      query: "secret",
      path: "private/path",
      notes: [{ title: "private" }],
      tag: "secret",
    };
    let saved = "";
    expect(
      saveDocumentBrowserPreferences(value, {
        setItem: (_key, text) => {
          saved = text;
        },
      }),
    ).toBe(true);
    expect(JSON.parse(saved)).toEqual({
      sort: "title",
      sortDirection: "desc",
      view: "all",
      fields: value.fields,
    });
    expect(readDocumentBrowserPreferences({ getItem: () => saved })).toEqual(
      JSON.parse(saved),
    );
    expect(saved).not.toContain("secret");
  });
  it("handles corrupted and unavailable storage", () => {
    const defaults = normalizeDocumentBrowserPreferences(null);
    expect(readDocumentBrowserPreferences({ getItem: () => "{" })).toEqual(
      defaults,
    );
    expect(
      readDocumentBrowserPreferences({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toEqual(defaults);
    expect(
      saveDocumentBrowserPreferences(
        {},
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
      ),
    ).toBe(false);
    expect(
      normalizeDocumentBrowserPreferences({
        view: "secret",
        sort: [],
        fields: { path: "no", modified: "yes" },
      }),
    ).toEqual(defaults);
  });
});

describe("static settings search", () => {
  const options = { web: true, updates: true };
  it("routes layout, code, passwords and update queries without reading config", () => {
    expect(searchSettings("行号", options)[0].action).toBe("typography");
    expect(searchSettings("列表 缩进", options)[0].action).toBe("typography");
    expect(searchSettings("密码", options)[0].action).toBe("help");
    expect(searchSettings("更新", options)[0].action).toBe("update");
    expect(searchSettings("ＶＩＭ", options)[0].page).toBe("editor");
    expect(searchSettings("不存在的关键词", options)).toEqual([]);
    expect(searchSettings("  ", options)).toEqual([]);
  });
  it("does not advertise unavailable platform features", () => {
    expect(searchSettings("更新", { web: false, updates: false })).toEqual([]);
    expect(searchSettings("诊断", { web: false, updates: false })).toEqual([]);
  });
});
