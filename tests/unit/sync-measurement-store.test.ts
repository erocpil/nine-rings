import { beforeEach, expect, it, vi } from "vitest";
import {
  measureTransfer,
  transferMeasurements,
  clearTransferMeasurements,
  subscribeTransfers,
} from "../../src/lib/sync/measurement-store";
beforeEach(clearTransferMeasurements);
it("keeps exact responses/errors and only projects approved aggregate fields", async () => {
  const response = new Response("PRIVATE_BODY", { status: 400 });
  const input = {
    kind: "blob" as const,
    transport: "native" as const,
    requestBytes: 123,
    token: "PRIVATE_TOKEN",
    body: "PRIVATE_BODY",
    url: "PRIVATE_URL",
  };
  expect(await measureTransfer(input, async () => response)).toBe(response);
  const reason = new Error("PRIVATE_FAILURE");
  await expect(
    measureTransfer(input, async () => {
      throw reason;
    }),
  ).rejects.toBe(reason);
  expect(transferMeasurements()).toMatchObject([
    { requestBytes: 123, status: 400, outcome: "response" },
    { status: null, outcome: "transport-error" },
  ]);
  expect(JSON.stringify(transferMeasurements())).not.toContain("PRIVATE");
});
it("bounds session records and a failing diagnostic listener cannot break a successful upload", async () => {
  const notify = vi.fn(() => {
    throw Error("listener failed");
  });
  const stop = subscribeTransfers(notify);
  for (let i = 0; i < 30; i++)
    await measureTransfer(
      { kind: "pointer", transport: "web", requestBytes: i },
      async () => new Response("{}"),
    );
  stop();
  expect(transferMeasurements()).toHaveLength(24);
  expect(transferMeasurements()[0].requestBytes).toBe(6);
});
