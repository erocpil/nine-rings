import { expect, test } from "@playwright/test";

test("大快照后台认证与同步算法一致，不阻塞页面且关闭上下文撤销任务", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor")).toBeVisible();
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const policy = await load("/src/lib/sync/candidate-write-policy.ts");
    const background = await load("/src/lib/sync/candidate-async-policy.ts");
    const fixtures = await fetch("/schema/sync/fixtures/candidate-structured-block-v1.json").then(response => response.json());
    const note = fixtures.notes[0];
    const source = JSON.stringify({ ...fixtures, notes: Array.from({ length: 80 }, (_, index) => ({ ...note, id: `worker-note-${index}`, content: { ops: Array.from({ length: 80 }, () => note.content.ops).flat() } })) });
    if (source.length < 256 * 1024) throw Error("Fixture must use the worker threshold");
    const expected = policy.reviewCandidatePayload(source, "web");
    const scope = policy.createCandidateEvaluationScope();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    try {
      const review = await background.reviewCandidatePayloadAsync(source, "web", scope);
      const changed = JSON.parse(source);
      changed.notes[0].content.ops[0].attributes = { unsupported: true };
      const rejected = await background.reviewCandidatePayloadAsync(JSON.stringify(changed), "web", scope);
      const pending = background.reviewCandidatePayloadAsync(source, "web", scope).then(() => false, () => true);
      policy.disposeCandidateEvaluationScope(scope);
      return { review, expected, ticks, rejected: !rejected.eligible, disposed: await pending };
    } finally { clearInterval(timer); policy.disposeCandidateEvaluationScope(scope); }
  });
  expect(result.review).toEqual(result.expected);
  expect(result.review.eligible).toBe(true);
  expect(result.ticks).toBeGreaterThan(0);
  expect(result.rejected).toBe(true);
  expect(result.disposed).toBe(true);
});
