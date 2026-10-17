import type { DocumentEditSessions } from "../document-edit-sessions";
import {
  HostCommandDispatcher,
  type HostCommandContext,
} from "./command-dispatcher";
import {
  contentResources,
  expandContent,
  type RegisteredContent,
} from "./content-resources";
import type { ParameterValues } from "./command-parameters";
import { pluginRuntime, PluginHostError } from "./runtime";
import { createSdkHost } from "./sdk-host";
import { createLoopbackSdkTransport, createPluginSdk } from "./sdk-client";
import type { SdkEditResult } from "./sdk-editor-handles";

/** User invocation of host-interpreted data, with the same target/save gates as SDK edits. */
export async function insertDeclarativeContent(
  entry: RegisteredContent,
  values: ParameterValues,
  sessions: DocumentEditSessions,
  context: () => HostCommandContext,
  signal: AbortSignal,
) {
  contentResources.assert(entry);
  const view = context().view;
  if (
    (view !== "render" && view !== "source") ||
    !entry.value.views.includes(view)
  )
    throw new PluginHostError("UNSUPPORTED_VIEW", "当前视图不支持此模板或片段");
  const input = expandContent(entry.value, values);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const release = pluginRuntime.own(entry.activation, abort);
  const sdk = createPluginSdk(
    createLoopbackSdkTransport(
      createSdkHost(
        pluginRuntime,
        entry.activation,
        new HostCommandDispatcher(pluginRuntime, sessions, context),
        "menu",
      ),
    ),
  );
  try {
    if (signal.aborted) controller.abort();
    const options = { signal: controller.signal };
    const target = await sdk.editor.captureSelection(options);
    contentResources.assert(entry);
    const result = await sdk.editor.insert(target, input, options);
    if (!result.ok)
      throw new PluginHostError(result.error.code, result.error.message);
    // Never retry an accepted edit, including when persistence subsequently fails.
    await sdk.documents.whenSaved(result.value as SdkEditResult, options);
  } finally {
    sdk.dispose();
    signal.removeEventListener("abort", abort);
    release();
  }
}
