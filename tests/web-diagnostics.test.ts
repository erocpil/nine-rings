import { summarizeDiagnosticBackup } from "../src/lib/web-diagnostics";

const secretContent = "绝不能出现在诊断中的正文";
const secretToken = "ghp_secret_token";
const summary = summarizeDiagnosticBackup({
  notes: [
    { storagePath: "projects/private", content: { ops: [{ insert: secretContent }] }, title: secretToken },
    { content: { ops: [] } },
    { storagePath: "areas/test", content: null },
  ] as Array<{ storagePath?: unknown; content?: unknown }>,
  daily_pages: [{ todos: [{ text: secretContent }, { text: secretToken }] }],
});

if (summary.notes !== 3 || summary.documents !== 2 || summary.dailyNotes !== 1) {
  throw new Error("诊断数量摘要错误");
}
if (summary.todos !== 2 || summary.malformedNotes !== 1) {
  throw new Error("诊断健康摘要错误");
}
const serialized = JSON.stringify(summary);
if (serialized.includes(secretContent) || serialized.includes(secretToken)) {
  throw new Error("诊断摘要泄漏正文或凭据");
}

console.log("6 passed, 0 failed");
