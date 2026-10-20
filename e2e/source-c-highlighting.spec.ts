import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource, selectDocumentLanguage, sourceInfo } from "./helpers/source-editor";

test("C/C++ 分类高亮随风格配色切换，可关闭且不改写源码", async ({ page }) => {
  await createBlankDocument(page, "代码分类");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  const raw = '#include <stdio.h>\n#define LIMIT 42\n// comment\nstruct Point { int x; };\nstatic int run(int n) {\n  struct Point p;\n  p.x = 42;\n  if (n > 0) return printf("hello\\n");\n  return 0;\n}\n';
  await replaceSource(area, raw);
  for (const [kind, text] of [["control", "return"], ["type", "int"], ["function", "printf"], ["function-definition", "run"], ["member", "x"], ["macro", "LIMIT"], ["preprocessor", "#include"], ["value", "42"], ["string", "hello"], ["comment", "comment"]]) {
    await expect(area.locator(`.source-code-${kind}`).filter({ hasText: text }).first()).toBeVisible();
  }
  const colors = await area.evaluate(element => {
    const root = document.documentElement, oldStyle = root.dataset.interfaceStyle, oldClass = root.className;
    const results: { colors: string[]; contrast: number[]; style: string; dark: boolean }[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const luminance = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).reduce((sum, value, i) => {
        const c = value / 255;
        return sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
      }, 0);
    };
    try {
      for (const style of ["classic", "calm", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) {
        for (const dark of [false, true]) {
          root.dataset.interfaceStyle = style;
          root.classList.remove("theme-light", "theme-dark");
          root.classList.add(dark ? "theme-dark" : "theme-light");
          const colors = ["control", "definition", "modifier", "type", "function", "member", "macro", "preprocessor", "string", "escape", "value", "comment", "operator"].map(kind => getComputedStyle(element.querySelector(`.source-code-${kind}`)!).color);
          const background = luminance(getComputedStyle(element.closest(".cm-editor")!).backgroundColor);
          results.push({ colors, style, dark, contrast: colors.map(color => {
            const foreground = luminance(color);
            return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
          }) });
        }
      }
    } finally {
      root.className = oldClass;
      if (oldStyle === undefined) delete root.dataset.interfaceStyle; else root.dataset.interfaceStyle = oldStyle;
    }
    return results;
  });
  for (const palette of colors) expect(new Set(palette.colors).size).toBeGreaterThanOrEqual(5);
  expect(colors[0].colors).not.toEqual(colors[1].colors);
  expect(colors.filter(palette => palette.contrast.some(value => value < 4.5))).toEqual([]);
  const toggle = page.getByRole("button", { name: "语法高亮", exact: true });
  await toggle.click();
  expect(await area.locator('.source-code-control').first().evaluate(el => getComputedStyle(el).color)).toBe(await area.evaluate(el => getComputedStyle(el).color));
  expect((await sourceInfo(area)).value).toBe(raw);
});

test("合并的 C/C++ 类型识别 C++ 类型、模板和成员调用，切换语言不残留分类", async ({ page }) => {
  await createBlankDocument(page, "C++ 分类");
  await selectDocumentLanguage(page, "c");
  const area = page.locator(".cm-content");
  const raw = 'namespace app {\ntemplate <typename T> class Box {\npublic:\n  T value;\n  T get() const { return value; }\n};\nint main() { Box<int> box; return box.get(); }\n}\n';
  await replaceSource(area, raw);
  await expect(area.locator(".source-code-type").filter({ hasText: "Box" }).first()).toBeVisible();
  await expect(area.locator(".source-code-function").filter({ hasText: "get" }).first()).toBeVisible();
  await expect(area.locator(".source-code-definition").filter({ hasText: "template" }).first()).toBeVisible();
  await selectDocumentLanguage(page, "python");
  const python = '@dataclass\nclass Packet:\n    size: int\n\ndef parse_packet(data: bytes) -> bool:\n    return data is not None\n';
  await replaceSource(area, python);
  await expect(area.locator(".source-code-definition").filter({ hasText: "def" }).first()).toBeVisible();
  await expect(area.locator(".source-code-type").filter({ hasText: "Packet" }).first()).toBeVisible();
  await expect(area.locator(".source-code-function-definition").filter({ hasText: "parse_packet" }).first()).toBeVisible();
  await expect(area.locator(".source-code-value").filter({ hasText: "None" }).first()).toBeVisible();
  expect((await sourceInfo(area)).value).toBe(python);
});
