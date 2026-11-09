import { expect, it, vi } from "vitest";
import { createBrowserOperationRunner } from "../../src/lib/local-files/browser-operation-core";
import type {
  BrowserOperation,
  BrowserOperationHost,
  BrowserOperationLease,
  BrowserItemResult,
} from "../../src/lib/local-files/browser-operation-contract";

const operation: BrowserOperation = {
  kind: "move",
  rootId: "left",
  rootName: "Left",
  parent: "src",
  nodes: ["src/a.c"],
  targetRootId: "right",
  targetRootName: "Right",
  targetParent: "dest",
};
function host() {
  let active = true;
  const leases: { release: ReturnType<typeof vi.fn> }[] = [];
  const port = {
    assertActive: () => {
      if (!active) throw new Error("revoked");
    },
    assertPathClean: vi.fn(async () => {}),
    lock: vi.fn(() => {
      const lease = { release: vi.fn() };
      leases.push(lease);
      return lease;
    }),
    files: {
      transfer: vi.fn(async () => "dest/a.c"),
      move: vi.fn(async () => "src/renamed.c"),
      trash: vi.fn(async () => {}),
      create: vi.fn(async () => "src/new"),
    },
    reconcileMove: vi.fn(async () => {}),
    reconcileTrash: vi.fn(async () => {}),
    notify: vi.fn(),
  } satisfies BrowserOperationHost<BrowserOperationLease>;
  return {
    port,
    leases,
    revoke: () => {
      active = false;
    },
  };
}
const decide = () => vi.fn(async () => ({ action: "stop" as const }));

it("uses the same guarded executor for isolated hosts, including move reconciliation", async () => {
  const a = host(),
    b = host(),
    signal = new AbortController().signal;
  for (const instance of [a, b]) {
    const result = await createBrowserOperationRunner(instance.port)(
      operation,
      "",
      signal,
      () => {},
      decide(),
    );
    expect(result).toMatchObject({ completed: 1, cancelled: false });
    expect(instance.port.files.transfer).toHaveBeenCalledWith(
      "left",
      "src/a.c",
      "right",
      "dest",
      "a.c",
      true,
    );
    expect(instance.port.assertPathClean).toHaveBeenLastCalledWith(
      "left",
      "src/a.c",
      instance.leases[0],
    );
    expect(instance.port.reconcileMove).toHaveBeenCalledWith(
      "left",
      "src/a.c",
      "right",
      "dest/a.c",
      "Right",
    );
    expect(instance.port.notify).toHaveBeenCalledWith({
      kind: "move",
      rootId: "left",
      node: "src/a.c",
      targetRootId: "right",
      targetNode: "dest/a.c",
    });
    expect(instance.leases[0].release).toHaveBeenCalledTimes(1);
  }
  a.revoke();
  await expect(
    createBrowserOperationRunner(a.port)(
      operation,
      "",
      signal,
      () => {},
      decide(),
    ),
  ).rejects.toThrow("revoked");
  expect(b.port.files.transfer).toHaveBeenCalledTimes(1);
});

it("rejects dirty preflight before taking leases or changing the filesystem", async () => {
  const { port } = host();
  port.assertPathClean.mockRejectedValueOnce(new Error("dirty"));
  const items: BrowserItemResult[] = [];
  await expect(
    createBrowserOperationRunner(port)(
      operation,
      "",
      new AbortController().signal,
      () => {},
      decide(),
      (item) => items.push(item),
    ),
  ).rejects.toThrow("dirty");
  expect(port.lock).not.toHaveBeenCalled();
  expect(port.files.transfer).not.toHaveBeenCalled();
  expect(items.at(-1)?.status).toBe("failed");
});

it("rechecks newly dirty paths under the exact lease and releases it on failure", async () => {
  const { port, leases } = host();
  port.assertPathClean
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error("new dirty edit"));
  await expect(
    createBrowserOperationRunner(port)(
      operation,
      "",
      new AbortController().signal,
      () => {},
      decide(),
    ),
  ).rejects.toThrow("new dirty edit");
  expect(port.assertPathClean).toHaveBeenLastCalledWith(
    "left",
    "src/a.c",
    leases[0],
  );
  expect(port.files.transfer).not.toHaveBeenCalled();
  expect(leases[0].release).toHaveBeenCalledOnce();
});

it("settles an in-flight write after cancellation and revocation without starting another", async () => {
  const instance = host(),
    controller = new AbortController();
  instance.port.files.transfer.mockImplementationOnce(async () => {
    controller.abort();
    instance.revoke();
    return "dest/a.c";
  });
  const result = await createBrowserOperationRunner(instance.port)(
    { ...operation, nodes: ["src/a.c", "src/b.c"] },
    "",
    controller.signal,
    () => {},
    decide(),
    () => {
      throw new Error("observer");
    },
  );
  expect(result).toMatchObject({ completed: 1, cancelled: true });
  expect(instance.port.files.transfer).toHaveBeenCalledOnce();
  expect(instance.port.reconcileMove).toHaveBeenCalledOnce();
  expect(instance.port.notify).toHaveBeenCalledOnce();
  expect(instance.leases[0].release).toHaveBeenCalledOnce();
});

for (const kind of [
  "move",
  "rename",
  "trash",
  "file",
  "directory",
  "copy",
] as const)
  it(`never retries a confirmed ${kind} when host reconciliation resembles a conflict`, async () => {
    const { port, leases } = host(),
      conflict = decide(),
      items: BrowserItemResult[] = [];
    if (kind === "move" || kind === "rename")
      port.reconcileMove.mockRejectedValueOnce(
        new Error("TARGET_EXISTS in host state"),
      );
    else if (kind === "trash")
      port.reconcileTrash.mockRejectedValueOnce(
        new Error("TARGET_EXISTS in host state"),
      );
    else
      port.notify.mockImplementationOnce(() => {
        throw new Error("TARGET_EXISTS in host notification");
      });
    await expect(
      createBrowserOperationRunner(port)(
        {
          ...operation,
          kind,
          nodes: kind === "file" || kind === "directory" ? [] : operation.nodes,
        },
        "new",
        new AbortController().signal,
        () => {},
        conflict,
        (item) => items.push(item),
      ),
    ).rejects.toThrow("TARGET_EXISTS");
    expect(conflict).not.toHaveBeenCalled();
    expect(items.at(-1)?.status).toBe("uncertain");
    const method =
      kind === "move" || kind === "copy"
        ? port.files.transfer
        : kind === "rename"
          ? port.files.move
          : kind === "trash"
            ? port.files.trash
            : port.files.create;
    expect(method).toHaveBeenCalledOnce();
    for (const lease of leases) expect(lease.release).toHaveBeenCalledOnce();
  });

it("releases host-owned method leases with their receiver intact", async () => {
  const { port } = host();
  const lease = {
    released: false,
    release() {
      this.released = true;
    },
  };
  const custom = { ...port, lock: () => lease };
  await createBrowserOperationRunner(custom)(
    operation,
    "",
    new AbortController().signal,
    () => {},
    decide(),
  );
  expect(lease.released).toBe(true);
});
