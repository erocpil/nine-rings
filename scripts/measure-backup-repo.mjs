#!/usr/bin/env node
/** Read-only GitHub metadata measurement. Default output contains no file paths. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  MeasurementError,
  parseMeasureArgs,
  liveRequester,
  fixtureRequester,
  measureRepository,
} from "./lib/backup-repo-measure.mjs";
export async function main(args = process.argv.slice(2)) {
  const options = parseMeasureArgs(args);
  const readJson = async (path) => {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new MeasurementError("测量输入文件不可读取或不是有效 JSON");
    }
  };
  const history = options.history ? await readJson(options.history) : [];
  if (!Array.isArray(history))
    throw new MeasurementError("历史样本应为报告数组");
  const fixture = options.fixture ? await readJson(options.fixture) : null;
  const request = fixture
    ? fixtureRequester(fixture)
    : liveRequester(process.env.GITHUB_TOKEN);
  const report = await measureRepository(options, request, {
    history,
    ...(fixture?.now ? { now: fixture.now } : {}),
  });
  console.log(JSON.stringify(report, null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      `测量失败：${error instanceof MeasurementError ? error.message : "输入或响应处理失败；未执行写入"}`,
    );
    process.exitCode = 1;
  });
}
