import {
  downloadExternalMarkdown,
  markdownContentFingerprint,
  normalizeExternalMarkdownUrl,
  resolveMarkdownResourceUrls,
} from "../src/lib/external-markdown-source";
import { mdToDelta } from "../src/lib/md-parser";
import { deltaToProseMirror } from "../src/lib/delta-converter";

let passed = 0;
let failed = 0;
const assert = (condition: boolean, message: string) => {
  if (condition) passed++;
  else { failed++; console.error(`  FAIL: ${message}`); }
};

console.log("\n── External Markdown source ──");

const github = normalizeExternalMarkdownUrl("https://github.com/example/project/blob/main/docs/README.md#readme");
assert(github.requestUrl === "https://raw.githubusercontent.com/example/project/main/docs/README.md",
  "GitHub blob URLs are normalized to raw content");
assert(github.provider === "github" && github.fileName === "README.md",
  "GitHub metadata is derived from the normalized URL");

let invalidProtocol = false;
try { normalizeExternalMarkdownUrl("file:///tmp/README.md"); } catch { invalidProtocol = true; }
assert(invalidProtocol, "non-http protocols are rejected");

let invalidExtension = false;
try { normalizeExternalMarkdownUrl("https://example.com/readme.html"); } catch { invalidExtension = true; }
assert(invalidExtension, "non-Markdown paths are rejected");

const rewritten = resolveMarkdownResourceUrls([
  "[Guide](guide/setup.md)",
  "![Logo](../images/logo.png)",
  "[Section](#install)",
  "```md",
  "[Literal](do-not-rewrite.md)",
  "```",
].join("\n"), "https://example.com/docs/README.md");
assert(rewritten.includes("https://example.com/docs/guide/setup.md"), "relative links are resolved");
assert(rewritten.includes("https://example.com/images/logo.png"), "relative images are resolved");
assert(rewritten.includes("[Section](#install)"), "fragment links remain local");
assert(rewritten.includes("[Literal](do-not-rewrite.md)"), "fenced code is not rewritten");

assert(markdownContentFingerprint("same") === markdownContentFingerprint("same"), "content fingerprints are stable");
assert(markdownContentFingerprint("same") !== markdownContentFingerprint("changed"), "content fingerprints detect changes");

let requestedUrl = "";
const downloaded = await downloadExternalMarkdown(
  "https://github.com/example/project/blob/main/README.md",
  {
    fetchImpl: (async (input) => {
      requestedUrl = String(input);
      return new Response("# Remote\n\n![Logo](logo.png)", {
        status: 200,
        headers: { "content-type": "text/plain", etag: "test-etag" },
      });
    }) as typeof fetch,
  },
);
assert(requestedUrl === "https://raw.githubusercontent.com/example/project/main/README.md",
  "downloads use the normalized raw URL");
assert(downloaded.source.startsWith("# Remote") && downloaded.etag === "test-etag",
  "downloaded Markdown and response metadata are returned");

let htmlRejected = false;
try {
  await downloadExternalMarkdown("https://example.com/README.md", {
    fetchImpl: (async () => new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch,
  });
} catch { htmlRejected = true; }
assert(htmlRejected, "HTML responses are rejected");

const imageDelta = mdToDelta("![Logo](https://example.com/logo.png)");
assert(imageDelta.ops.some((op) => typeof op.insert === "object" && "image" in op.insert),
  "Markdown images become image embeds");
assert((deltaToProseMirror(imageDelta).content as Array<{ type: string }>).some((node) => node.type === "resizableImage"),
  "imported images use the editor's registered image node");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
