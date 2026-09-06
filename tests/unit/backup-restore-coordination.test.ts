import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  acknowledgeBackupRestore,
  assertRestoreContext,
  CorruptRestoreRecordError,
  inspectBackupRestore,
  RESTORE_JOURNAL_KEY,
  withBackupRestore,
  withBackupRestoreReadLock,
  type RestoreContext,
} from "../../src/lib/backup-restore-coordination";

let items: Map<string, string>;
let held: boolean;
beforeEach(() => {
  items = new Map();
  held = false;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => unknown,
      ) => {
        if (held) return callback(null);
        held = true;
        try {
          return await callback({});
        } finally {
          held = false;
        }
      },
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const seedInterrupted = () => {
  const record = {
    version: 1,
    id: "interrupted",
    source: "github",
    mode: "replace",
    phase: "applying",
    startedAt: "2026-09-07T00:00:00Z",
    updatedAt: "2026-09-07T00:00:00Z",
  };
  items.set(RESTORE_JOURNAL_KEY, JSON.stringify(record));
  return record;
};

it("互斥锁阻止并行恢复，不排队执行陈旧预检", async () => {
  let release!: () => void;
  let context!: RestoreContext;
  const first = withBackupRestore("file", "merge", async (operation) => {
    context = operation;
    operation.setPhase("applying");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return "ok";
  });
  await expect(inspectBackupRestore()).resolves.toMatchObject({
    active: true,
    interrupted: false,
  });
  const write = vi.fn();
  await expect(withBackupRestore("github", "replace", write)).rejects.toThrow(
    "另一个窗口",
  );
  expect(write).not.toHaveBeenCalled();
  await expect(acknowledgeBackupRestore("interrupted")).rejects.toThrow(
    "仍在进行",
  );
  release();
  await expect(first).resolves.toBe("ok");
  expect(() => assertRestoreContext(context)).toThrow("已结束");
  expect((await inspectBackupRestore()).record?.phase).toBe("completed");
});

it("中断记录阻止新恢复，确认仅更新记录且要求 ID 匹配", async () => {
  seedInterrupted();
  expect(await inspectBackupRestore()).toMatchObject({
    active: false,
    interrupted: true,
  });
  const write = vi.fn();
  await expect(withBackupRestore("file", "merge", write)).rejects.toThrow(
    "上次恢复中断",
  );
  expect(write).not.toHaveBeenCalled();
  await expect(acknowledgeBackupRestore("stale")).rejects.toThrow("已变化");
  await acknowledgeBackupRestore("interrupted");
  expect((await inspectBackupRestore()).record?.phase).toBe("acknowledged");
  await withBackupRestore("file", "merge", async () => {
    write();
  });
  expect(write).toHaveBeenCalledTimes(1);
});

it("日志写失败或缺少锁支持时，数据操作不启动", async () => {
  const write = vi.fn();
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  await expect(withBackupRestore("file", "merge", write)).rejects.toThrow(
    "quota",
  );
  expect(write).not.toHaveBeenCalled();
  spy.mockRestore();
  vi.stubGlobal("navigator", {});
  await expect(withBackupRestore("file", "merge", write)).rejects.toThrow(
    "不支持跨窗口",
  );
  expect(write).not.toHaveBeenCalled();
});

it("数据已提交但完成记录写失败时，保留待检查状态，不再次执行", async () => {
  const set = localStorage.setItem;
  vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    if (JSON.parse(value).phase === "completed") throw new Error("quota");
    set(key, value);
  });
  const write = vi.fn();
  await expect(
    withBackupRestore("file", "merge", async (operation) => {
      operation.setPhase("applying");
      write();
    }),
  ).rejects.toThrow("数据恢复已执行");
  expect(write).toHaveBeenCalledTimes(1);
  expect(await inspectBackupRestore()).toMatchObject({ interrupted: true });
});

it("回滚仍使用原锁，记录阶段不被嵌套导入覆盖，错误不写入日志", async () => {
  await expect(
    withBackupRestore("github", "replace", async (operation) => {
      operation.setPhase("applying");
      operation.setPhase("rolling-back");
      operation.setPhase("applying");
      expect(JSON.parse(items.get(RESTORE_JOURNAL_KEY)!).phase).toBe(
        "rolling-back",
      );
      await expect(
        withBackupRestore("file", "merge", async () => {}),
      ).rejects.toThrow("另一个窗口");
      throw new Error("secret-token-and-private-note");
    }),
  ).rejects.toThrow("secret-token");
  expect(items.get(RESTORE_JOURNAL_KEY)).not.toContain("secret");
  expect((await inspectBackupRestore()).record?.phase).toBe("needs-review");
  const retry = vi.fn();
  await expect(withBackupRestore("file", "merge", retry)).rejects.toThrow(
    "尚待检查",
  );
  expect(retry).not.toHaveBeenCalled();
});

it("写入前失败可重新预检，开始写入后的失败必须确认", async () => {
  await expect(
    withBackupRestore("github", "merge", async () => {
      throw new Error("validation failed");
    }),
  ).rejects.toThrow("validation failed");
  expect((await inspectBackupRestore()).record?.phase).toBe("failed");
  await expect(
    withBackupRestore("file", "merge", async (operation) => {
      expect(operation.mutationStarted).toBe(false);
      operation.setPhase("applying");
      expect(operation.mutationStarted).toBe(true);
      throw new Error("write failed");
    }),
  ).rejects.toThrow("write failed");
  const status = await inspectBackupRestore();
  expect(status.record?.phase).toBe("needs-review");
  expect(status.interrupted).toBe(false);
  await acknowledgeBackupRestore(status.record!.id);
  await expect(
    withBackupRestore("file", "merge", async () => "retry"),
  ).resolves.toBe("retry");
});

it("写入阶段记录失败不算开始数据写入，提交标志先于收尾日志", async () => {
  const set = localStorage.setItem;
  const spy = vi
    .spyOn(localStorage, "setItem")
    .mockImplementation((key, value) => {
      if (JSON.parse(value).phase === "applying") throw new Error("quota");
      set(key, value);
    });
  let context!: RestoreContext;
  await expect(
    withBackupRestore("file", "replace", async (operation) => {
      context = operation;
      operation.setPhase("applying");
    }),
  ).rejects.toThrow("quota");
  expect(context.mutationStarted).toBe(false);
  expect((await inspectBackupRestore()).record?.phase).toBe("failed");
  spy.mockImplementation((key, value) => {
    if (JSON.parse(value).phase === "finalizing") throw new Error("quota");
    set(key, value);
  });
  await expect(
    withBackupRestore("file", "replace", async (operation) => {
      context = operation;
      operation.setPhase("applying");
      operation.markDataCommitted();
    }),
  ).rejects.toThrow("quota");
  expect(context.dataCommitted).toBe(true);
  expect((await inspectBackupRestore()).record?.phase).toBe("needs-review");
  expect(() => context.markDataCommitted()).toThrow("已结束");
});

it("存储不可读不等于日志损坏，不能因此清理日志", async () => {
  seedInterrupted();
  const remove = vi.spyOn(localStorage, "removeItem");
  const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("storage denied");
  });
  await expect(acknowledgeBackupRestore(null)).rejects.toThrow(
    "storage denied",
  );
  expect(remove).not.toHaveBeenCalled();
  read.mockRestore();
  expect((await inspectBackupRestore()).record?.id).toBe("interrupted");
  items.set(RESTORE_JOURNAL_KEY, "invalid");
  await expect(inspectBackupRestore()).rejects.toBeInstanceOf(
    CorruptRestoreRecordError,
  );
});

it("检查副本导出占用恢复锁但不改日志，导出失败也释放锁", async () => {
  seedInterrupted();
  const before = items.get(RESTORE_JOURNAL_KEY);
  await expect(
    withBackupRestoreReadLock(async () => {
      const write = vi.fn();
      await expect(withBackupRestore("file", "merge", write)).rejects.toThrow(
        "另一个窗口",
      );
      expect(write).not.toHaveBeenCalled();
      await expect(acknowledgeBackupRestore("interrupted")).rejects.toThrow(
        "仍在进行",
      );
      throw new Error("download failed");
    }),
  ).rejects.toThrow("download failed");
  expect(items.get(RESTORE_JOURNAL_KEY)).toBe(before);
  await acknowledgeBackupRestore("interrupted");
  await withBackupRestore("file", "merge", async () => {
    await expect(withBackupRestoreReadLock(async () => {})).rejects.toThrow(
      "等待完成",
    );
  });
});

it("损坏日志不被静默覆盖，必须显式确认且不能清理新记录", async () => {
  items.set(RESTORE_JOURNAL_KEY, "invalid");
  await expect(
    withBackupRestore("file", "merge", async () => {}),
  ).rejects.toThrow();
  await acknowledgeBackupRestore(null);
  expect(items.has(RESTORE_JOURNAL_KEY)).toBe(false);
  seedInterrupted();
  await expect(acknowledgeBackupRestore(null)).rejects.toThrow("已变化");
});
