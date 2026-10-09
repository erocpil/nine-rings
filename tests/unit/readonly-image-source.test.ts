import { expect, it } from "vitest";
import { readonlyImageSource } from "../../src/lib/readonly-image-source";

it("supports bundled and relative images in browser and native origins", () => {
  for (const base of [
    "http://localhost:8000/",
    "tauri://localhost/",
    "https://tauri.localhost/",
  ])
    for (const source of [
      "/ragdoll-32.png",
      "./icon-192.svg",
      "../images/icon.png",
    ])
      expect(readonlyImageSource(source, base)).toBe(source);
});
it("preserves supported remote and embedded images", () => {
  for (const source of [
    "https://example.com/image.png",
    "data:image/png;base64,YQ==",
    "blob:http://localhost:8000/image",
  ])
    expect(readonlyImageSource(source, "http://localhost:8000/")).toBe(source);
});
it("rejects active or non-image URLs, including whitespace-obfuscated schemes", () => {
  for (const source of [
    "javascript:alert(1)",
    " java\nscript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/icon.png",
    "",
    "http://[",
  ])
    expect(readonlyImageSource(source, "http://localhost:8000/")).toBe("");
});
