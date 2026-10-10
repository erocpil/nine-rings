import { PluginHostError } from "./runtime";
import type { CommandResponse } from "./command-dispatcher";

export const SDK_PROTOCOL = 1;
export const SDK_MESSAGE_BYTES = 128000;
export type SdkMethod =
  | "capabilities.query"
  | "commands.execute"
  | "requests.cancel"
  | "editor.captureSelection"
  | "editor.insertAtSelection"
  | "editor.insert"
  | "documents.whenSaved"
  | "documents.snapshot";
export interface SdkRequest {
  protocol: 1;
  requestId: string;
  method: SdkMethod;
  params: Record<string, unknown>;
}
export interface SdkResponse {
  protocol: 1;
  response: CommandResponse;
}
export const validRequestId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9:_-]{1,128}$/.test(value) &&
  value !== "invalid";

/** JSON only, including loopback: no live objects, accessors or unbounded trees. */
export function cloneSdkValue<T>(value: T): T {
  let budget = 4096;
  const ancestors = new Set<object>();
  const visit = (next: unknown, depth: number): void => {
    if (--budget < 0 || depth > 16) throw new Error("budget");
    if (next === null || typeof next === "boolean") return;
    if (typeof next === "string") {
      if (next.length > SDK_MESSAGE_BYTES) throw new Error("string budget");
      return;
    }
    if (typeof next === "number" && Number.isFinite(next)) return;
    if (!next || typeof next !== "object" || ancestors.has(next))
      throw new Error("JSON value");
    if (
      !Array.isArray(next) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(next))
    )
      throw new Error("plain object");
    if (
      Object.getOwnPropertySymbols(next).length ||
      (Array.isArray(next) &&
        (next.length > 4096 ||
          Object.keys(next).length !== next.length ||
          Object.keys(next).some((key, index) => key !== String(index))))
    )
      throw new Error("JSON members");
    ancestors.add(next);
    for (const key of Object.keys(next)) {
      if (key.length > SDK_MESSAGE_BYTES) throw new Error("key budget");
      if (["__proto__", "constructor", "prototype"].includes(key))
        throw new Error("reserved key");
      const descriptor = Object.getOwnPropertyDescriptor(next, key)!;
      if (!("value" in descriptor)) throw new Error("accessor");
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(next);
  };
  try {
    visit(value, 0);
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength > SDK_MESSAGE_BYTES)
      throw new Error("bytes");
    return JSON.parse(json) as T;
  } catch {
    throw new PluginHostError("INVALID_ARGUMENT", "SDK 消息无效或超出限制");
  }
}

export function parseSdkResponse(input: unknown): SdkResponse {
  const envelope = cloneSdkValue(input) as SdkResponse;
  const response = envelope?.response;
  const errorCodes = [
    "PLUGIN_DISABLED",
    "PERMISSION_DENIED",
    "READ_ONLY",
    "STALE_TARGET",
    "STALE_REVISION",
    "INVALID_ARGUMENT",
    "UNSUPPORTED_PLATFORM",
    "UNSUPPORTED_VIEW",
    "TIMEOUT",
    "CANCELLED",
    "DUPLICATE_REQUEST",
    "COMMAND_NOT_FOUND",
    "SAVE_FAILED",
    "INTERNAL_ERROR",
  ];
  if (
    !envelope ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    envelope.protocol !== 1 ||
    Object.keys(envelope).some(
      (key) => !["protocol", "response"].includes(key),
    ) ||
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    typeof response.ok !== "boolean" ||
    typeof response.applied !== "boolean" ||
    (!validRequestId(response.requestId) && response.requestId !== "invalid") ||
    Object.keys(response).some(
      (key) =>
        ![
          "ok",
          "requestId",
          "applied",
          response.ok ? "value" : "error",
        ].includes(key),
    ) ||
    (response.ok
      ? !Object.prototype.hasOwnProperty.call(response, "value")
      : !response.error ||
        !errorCodes.includes(response.error.code) ||
        typeof response.error.message !== "string")
  )
    throw new PluginHostError("INVALID_ARGUMENT", "SDK 响应协议无效");
  return envelope;
}

export function parseSdkRequest(value: unknown): SdkRequest {
  const copy = cloneSdkValue(value);
  if (!copy || typeof copy !== "object" || Array.isArray(copy))
    throw new PluginHostError("INVALID_ARGUMENT", "SDK 请求无效");
  const request = copy as SdkRequest;
  if (
    Object.keys(copy).some(
      (key) => !["protocol", "requestId", "method", "params"].includes(key),
    ) ||
    request.protocol !== SDK_PROTOCOL ||
    !validRequestId(request.requestId) ||
    ![
      "capabilities.query",
      "commands.execute",
      "requests.cancel",
      "editor.captureSelection",
      "editor.insertAtSelection",
      "editor.insert",
      "documents.whenSaved",
      "documents.snapshot",
    ].includes(request.method) ||
    !request.params ||
    typeof request.params !== "object" ||
    Array.isArray(request.params)
  )
    throw new PluginHostError("INVALID_ARGUMENT", "SDK 请求协议无效");
  const allowed =
    request.method === "commands.execute"
      ? ["commandId", "args"]
      : request.method === "requests.cancel"
        ? ["requestId"]
        : request.method === "editor.insert"
          ? ["target", "content"]
          : request.method === "editor.insertAtSelection"
            ? ["content"]
            : request.method === "documents.whenSaved"
              ? ["documentId", "revision"]
              : [];
  if (
    Object.keys(request.params).some((key) => !allowed.includes(key)) ||
    (request.method === "commands.execute" &&
      typeof request.params.commandId !== "string") ||
    (request.method === "requests.cancel" &&
      !validRequestId(request.params.requestId)) ||
    (request.method === "editor.insert" &&
      !validRequestId(request.params.target)) ||
    (request.method === "documents.whenSaved" &&
      (typeof request.params.documentId !== "string" ||
        !request.params.documentId ||
        request.params.documentId.length > 1024 ||
        !validRequestId(request.params.revision)))
  )
    throw new PluginHostError("INVALID_ARGUMENT", "SDK 请求参数无效");
  if (["editor.insert", "editor.insertAtSelection"].includes(request.method)) {
    const content = request.params.content as
      Record<string, unknown> | undefined;
    if (
      !content ||
      typeof content !== "object" ||
      Array.isArray(content) ||
      Object.keys(content).some((key) => !["format", "value"].includes(key)) ||
      !["text", "markdown"].includes(content.format as string) ||
      typeof content.value !== "string"
    )
      throw new PluginHostError("INVALID_ARGUMENT", "SDK 插入内容无效");
  }
  return request;
}
