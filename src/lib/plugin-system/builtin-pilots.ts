import { localDateKey } from "../local-date";
import { extractPlainText } from "../storage/core";
import type { DocumentEditSessions } from "../document-edit-sessions";
import {
  HostCommandDispatcher,
  type HostCommandContext,
} from "./command-dispatcher";
import { pluginLifecycle } from "./lifecycle";
import {
  pluginRuntime,
  PluginHostError,
  type PluginPermission,
} from "./runtime";
import { createSdkHost } from "./sdk-host";
import { createLoopbackSdkTransport, createPluginSdk } from "./sdk-client";
import type { SdkEditResult } from "./sdk-editor-handles";

export type BuiltinPilot = "date" | "statistics";
export const builtinPilotId = (kind: BuiltinPilot) =>
  `nine-rings.builtin-${kind}`;

/** Explicit user invocation only; the host owns identity, context and permissions. */
export async function activateBuiltinPilot(
  kind: BuiltinPilot,
  sessions: DocumentEditSessions,
  context: () => HostCommandContext,
) {
  const id = builtinPilotId(kind);
  const permissions: PluginPermission[] =
    kind === "date"
      ? [
          "editor.selection.read",
          "editor.selection.write",
          "documents.current.read",
        ]
      : ["documents.current.read"];
  let sdk!: ReturnType<typeof createPluginSdk>;
  let signal!: AbortSignal;
  await pluginLifecycle.activate(id, permissions, {
    activate(owner) {
      signal = owner.signal;
      const dispatcher = new HostCommandDispatcher(
        pluginRuntime,
        sessions,
        context,
      );
      sdk = createPluginSdk(
        createLoopbackSdkTransport(
          createSdkHost(pluginRuntime, owner.activation, dispatcher, "menu"),
        ),
      );
      owner.own(() => sdk.dispose());
    },
  });
  return { sdk, signal, dispose: () => pluginLifecycle.deactivate(id) };
}

export async function insertBuiltinDate(
  sdk: ReturnType<typeof createPluginSdk>,
  signal: AbortSignal,
  date = new Date(),
) {
  const capabilities = await sdk.capabilities({ signal });
  if (
    !capabilities.methods.includes("editor.captureSelection") ||
    !capabilities.methods.includes("editor.insert")
  )
    throw new PluginHostError("UNSUPPORTED_VIEW", "当前视图不能插入日期");
  const target = await sdk.editor.captureSelection({ signal });
  const result = await sdk.editor.insert(
    target,
    { format: "text", value: localDateKey(date) },
    { signal },
  );
  if (!result.ok)
    throw new PluginHostError(result.error.code, result.error.message);
  // An accepted edit is not a persisted edit. Never repeat insertion after failure.
  await sdk.documents.whenSaved(result.value as SdkEditResult, { signal });
}

export function builtinDocumentStatistics(content: unknown) {
  const text = extractPlainText(content).replace(/\r\n?/g, "\n");
  return {
    characters: Array.from(text).length,
    nonWhitespace: Array.from(text.replace(/\s/g, "")).length,
    lines: text ? text.split("\n").length : 0,
  };
}
