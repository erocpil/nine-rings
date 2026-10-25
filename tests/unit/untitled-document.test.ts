import { describe, expect, it } from "vitest";
import { untitledDocumentName } from "../../src/lib/untitled-document";

describe("untitled document naming", () => {
  const documents = [
    { id: "1", title: "未命名", storagePath: "ideas/test" },
    { id: "2", title: "未命名 2", storagePath: "ideas/test" },
    { id: "3", title: "未命名 3", storagePath: "projects/test" },
    { id: "4", title: "", storagePath: "ideas/test" },
  ];
  it("allocates a free name among siblings only", () => {
    expect(untitledDocumentName(documents, "ideas/test")).toBe("未命名 3");
    expect(untitledDocumentName(documents, "areas/test")).toBe("未命名");
  });
  it("preserves an existing numbered default when clearing its own title", () => {
    expect(untitledDocumentName(documents, "ideas/test", "2", "未命名 2")).toBe(
      "未命名 2",
    );
    expect(untitledDocumentName(documents, "ideas/test", "1", "未命名")).toBe(
      "未命名",
    );
  });
  it("does not preserve colliding defaults or use a custom title as the default", () => {
    expect(untitledDocumentName(documents, "ideas/test", "4", "未命名 2")).toBe(
      "未命名 3",
    );
    expect(
      untitledDocumentName(documents, "ideas/test", "4", "My document"),
    ).toBe("未命名 3");
  });
});
