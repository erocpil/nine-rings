/** Candidate payload eligibility only. Never applies data or enables a protocol. */
import { normalizeEditorColor } from "../editor-color";
import { validateBackup } from "../backup-validation";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../backup-user-settings";
import { isEncrypted, validateEncryptedContent } from "../document-crypto";
import { isPathUnder, normalizeStoragePath } from "../storage/core";
import { canonicalJson } from "./canonical-codec";
import { parseSyncJson } from "./strict-json";
import {
  assertSyncCapabilities,
  type SyncCapabilities,
} from "./protocol-capabilities";

export type CandidateRuntime = "web" | "tauri" | "flutter";
export type CandidateIssue =
  | "invalid-payload"
  | "unknown-metadata"
  | "noncanonical-fields"
  | "unsupported-content"
  | "settings-not-certified"
  | "settings-loss"
  | "duplicate-template-source"
  | "runtime-unsupported"
  | "protection-mismatch"
  | "protected-search-text";
export interface CandidateReview {
  eligible: boolean;
  issues: Partial<Record<CandidateIssue, number>>;
  requiredFeatures: string[];
  counts: {
    documents: number;
    templates: number;
    protectedPaths: number;
    protectedVersions: number;
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const decoded = (value: unknown): unknown =>
  typeof value === "string" ? parseSyncJson(value) : value;
const stringList = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const sameProtection = (a: unknown, b: unknown): boolean =>
  isEncrypted(a) &&
  isEncrypted(b) &&
  a.encrypted.protectionId === b.encrypted.protectionId &&
  a.encrypted.salt === b.encrypted.salt &&
  a.encrypted.iterations === b.encrypted.iterations;
const fields = {
  root: [
    "version",
    "exported_at",
    "notes",
    "templates",
    "config",
    "user_settings",
    "protected_paths",
    "protected_versions",
    "backup_metadata",
    "header",
  ],
  note: [
    "id",
    "date",
    "title",
    "content",
    "tags",
    "pinned",
    "readonly",
    "sort_order",
    "created_at",
    "updated_at",
    "storagePath",
    "storage_path",
    "docType",
    "doc_type",
    "concepts",
    "linkedDocIds",
    "linked_doc_ids",
    "search_text",
    "searchText",
    "deleted_at",
  ],
  template: [
    "id",
    "name",
    "description",
    "is_builtin",
    "title_template",
    "tags",
    "storage_path",
    "doc_type",
    "concepts",
    "pinned",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  path: ["id", "path", "verifier", "createdAt", "updatedAt"],
  history: [
    "id",
    "note_id",
    "title",
    "content",
    "tags",
    "pinned",
    "sort_order",
    "saved_at",
  ],
  encrypted: ["version", "protectionId", "salt", "iterations", "iv", "data"],
};

/** Redacted diagnostics, not a promise of arbitrary editor/storage round-trip. */
export function reviewCandidatePayload(
  source: string,
  runtime: CandidateRuntime,
): CandidateReview {
  const issues: CandidateReview["issues"] = {};
  const required = new Set<string>();
  const counts = {
    documents: 0,
    templates: 0,
    protectedPaths: 0,
    protectedVersions: 0,
  };
  const issue = (code: CandidateIssue) => {
    issues[code] = (issues[code] ?? 0) + 1;
  };
  const unknown = (
    value: Record<string, unknown>,
    allowed: readonly string[],
  ) => {
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      issue("unknown-metadata");
  };
  const content = (input: unknown): Record<string, unknown> => {
    const value = decoded(input);
    if (!record(value)) throw Error();
    if (isEncrypted(value)) {
      validateEncryptedContent(value);
      unknown(
        value.encrypted as unknown as Record<string, unknown>,
        fields.encrypted,
      );
      required.add("encrypted-document-v1");
      if (runtime === "flutter") issue("runtime-unsupported");
    } else {
      required.add("text-document-v1");
      if (
        Object.keys(value).some((key) => key !== "ops") ||
        !Array.isArray(value.ops)
      ) {
        issue("unsupported-content");
      } else
        for (const op of value.ops) {
          if (
            !record(op) ||
            typeof op.insert !== "string" ||
            Object.keys(op).some((k) => !["insert", "attributes"].includes(k))
          ) {
            issue("unsupported-content");
            continue;
          }
          if (op.attributes !== undefined) {
            if (
              !record(op.attributes) ||
              Object.entries(op.attributes).some(([key, val]) =>
                key === "header"
                  ? !Number.isInteger(val) ||
                    (val as number) < 1 ||
                    (val as number) > 6
                  : key === "color" || key === "background"
                    ? typeof val !== "string" ||
                      normalizeEditorColor(val) !== val
                    : key === "size"
                      ? !["small", "normal", "large", "huge"].includes(
                          String(val),
                        ) || typeof val !== "string"
                      : ![
                          "bold",
                          "italic",
                          "strike",
                          "code",
                          "highlight",
                        ].includes(key) || typeof val !== "boolean",
              )
            )
              issue("unsupported-content");
            if (record(op.attributes)) {
              const attrs = op.attributes;
              if (
                (attrs.background !== undefined && attrs.highlight !== true) ||
                (attrs.code === true && Object.keys(attrs).length > 1)
              )
                issue("unsupported-content");
              if (
                ["color", "size", "highlight", "background"].some(
                  (key) => attrs[key] !== undefined,
                )
              ) {
                required.add("inline-appearance-v1");
                if (runtime === "flutter") issue("runtime-unsupported");
              }
            }
          }
        }
    }
    if (!isEncrypted(value) && Array.isArray(value.ops)) {
      const ops = value.ops;
      const last = ops[ops.length - 1];
      const formatted = ops.some(
        (op) =>
          record(op) &&
          record(op.attributes) &&
          Object.keys(op.attributes).length > 0,
      );
      if (
        formatted &&
        ops.some(
          (op) =>
            record(op) &&
            typeof op.insert === "string" &&
            op.insert !== "\n" &&
            op.insert.includes("\n"),
        )
      )
        issue("unsupported-content");
      if (
        !record(last) ||
        typeof last.insert !== "string" ||
        !last.insert.endsWith("\n") ||
        ops.some(
          (op) =>
            record(op) &&
            typeof op.insert === "string" &&
            (op.insert.includes("\r") ||
              (record(op.attributes) &&
                (Object.values(op.attributes).some((v) => v === false) ||
                  (op.attributes.header !== undefined
                    ? op.insert !== "\n" ||
                      Object.keys(op.attributes).length !== 1
                    : op.insert.includes("\n") &&
                      Object.keys(op.attributes).length > 0)))),
        )
      )
        issue("unsupported-content");
    }
    return value;
  };
  try {
    if (!["web", "tauri", "flutter"].includes(runtime)) throw Error();
    const bundle = parseSyncJson(source);
    if (!record(bundle)) throw Error();
    // Shape-only legacy validation; the separate public write gate checks the
    // envelope first. No storage adapter is called and the input is not mutated.
    const payload = Object.fromEntries(
      Object.entries(bundle).filter(([key]) => key !== "header"),
    );
    validateBackup(payload);
    if (![1, 2].includes(payload.version as number)) throw Error();
    unknown(bundle, fields.root);
    if (record(bundle.header)) {
      unknown(bundle.header, [
        "kind",
        "format",
        "codec",
        "requires",
        "id",
        "parent",
        "createdAt",
        "writtenBy",
      ]);
      for (const [key, allowed] of [
        ["requires", ["read", "write", "readFeatures", "writeFeatures"]],
        ["parent", ["id", "sha256"]],
        ["writtenBy", ["app", "platform", "deviceId"]],
      ] as const) {
        if (record(bundle.header[key]))
          unknown(bundle.header[key] as Record<string, unknown>, allowed);
      }
    }
    if (runtime === "flutter" && payload.version === 2)
      issue("runtime-unsupported");
    if (bundle.backup_metadata !== undefined) {
      if (
        !record(bundle.backup_metadata) ||
        bundle.backup_metadata.version !== 1 ||
        !record(bundle.backup_metadata.device)
      )
        throw Error();
      const device = bundle.backup_metadata.device;
      unknown(bundle.backup_metadata, ["version", "exportedAt", "device"]);
      if (
        typeof bundle.backup_metadata.exportedAt !== "string" ||
        ["id", "name", "platform"].some((k) => typeof device[k] !== "string") ||
        !["web", "tauri"].includes(
          bundle.backup_metadata.device.runtime as string,
        ) ||
        (bundle.backup_metadata.device.userAgent !== undefined &&
          typeof bundle.backup_metadata.device.userAgent !== "string")
      )
        throw Error();
      unknown(bundle.backup_metadata.device, [
        "id",
        "name",
        "runtime",
        "platform",
        "userAgent",
      ]);
    }
    const notes = payload.notes;
    counts.documents = notes.length;
    const bodies = new Map<string, Record<string, unknown>>();
    for (const note of notes) {
      unknown(note, fields.note);
      for (const [camel, snake] of [
        ["storagePath", "storage_path"],
        ["docType", "doc_type"],
        ["linkedDocIds", "linked_doc_ids"],
        ["searchText", "search_text"],
      ]) {
        if (note[camel] !== undefined && note[snake] !== undefined)
          issue("noncanonical-fields");
      }
      const path = note.storagePath ?? note.storage_path;
      if (
        typeof path === "string" &&
        path &&
        normalizeStoragePath(path) !== path
      )
        issue("noncanonical-fields");
      if (
        typeof note.pinned !== "boolean" ||
        typeof note.readonly !== "boolean" ||
        !Number.isSafeInteger(note.sort_order) ||
        ["date", "created_at", "updated_at"].some(
          (k) => typeof note[k] !== "string",
        ) ||
        !(note.title === null || typeof note.title === "string") ||
        !stringList(decoded(note.tags)) ||
        note.deleted_at != null ||
        [note.search_text, note.searchText].some(
          (v) => v != null && typeof v !== "string",
        )
      )
        issue("noncanonical-fields");
      if (
        (note.sort_order as number) < -2147483648 ||
        (note.sort_order as number) > 2147483647
      )
        issue("noncanonical-fields");
      if (
        runtime === "tauri" &&
        (typeof note.content === "string" ||
          [
            note.tags,
            note.concepts,
            note.linkedDocIds,
            note.linked_doc_ids,
          ].some((v) => typeof v === "string") ||
          typeof note.search_text !== "string")
      )
        issue("noncanonical-fields");
      const body = content(note.content);
      bodies.set(note.id, body);
      if (
        isEncrypted(body) &&
        [note.search_text, note.searchText].some((v) => v != null && v !== "")
      )
        issue("protected-search-text");
    }
    const templates = payload.templates ?? [];
    counts.templates = templates.length;
    if (templates.length) {
      required.add("template-metadata-v1");
      if (runtime === "flutter") issue("runtime-unsupported");
    }
    for (const template of templates) {
      unknown(template, fields.template);
      if (
        typeof template.description !== "string" ||
        typeof template.is_builtin !== "boolean" ||
        typeof template.pinned !== "boolean" ||
        !Number.isSafeInteger(template.sort_order) ||
        typeof template.created_at !== "string" ||
        typeof template.updated_at !== "string" ||
        !stringList(template.tags) ||
        !stringList(template.concepts) ||
        ["title_template", "storage_path", "doc_type"].some(
          (k) => template[k] !== null && typeof template[k] !== "string",
        )
      )
        issue("noncanonical-fields");
    }
    if (payload.config != null) issue("settings-not-certified");
    if (bundle.user_settings !== undefined) {
      required.add("frontend-settings-v1");
      if (runtime === "flutter") issue("runtime-unsupported");
      const input = bundle.user_settings;
      if (!record(input) || input.version !== 1 || !record(input.values))
        throw Error();
      if (
        Object.prototype.hasOwnProperty.call(
          input.values,
          "nine-rings:templates",
        )
      )
        issue("duplicate-template-source");
      const values = new Map<string, string>();
      const memory = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      };
      restoreFrontendSettings(input, memory);
      if (
        canonicalJson(collectFrontendSettings(memory)) !== canonicalJson(input)
      )
        issue("settings-loss");
    }
    const paths = payload.protected_paths ?? [];
    counts.protectedPaths = paths.length;
    if (paths.length) required.add("protected-path-v1");
    for (const path of paths) {
      unknown(path as unknown as Record<string, unknown>, fields.path);
      content(path.verifier);
      for (const note of notes) {
        const storagePath = note.storagePath ?? note.storage_path;
        if (
          typeof storagePath === "string" &&
          isPathUnder(storagePath, path.path)
        ) {
          const body = bodies.get(note.id);
          if (!sameProtection(body, path.verifier))
            issue("protection-mismatch");
        }
      }
    }
    const versions = payload.protected_versions ?? [];
    counts.protectedVersions = versions.length;
    if (versions.length) required.add("protected-history-v1");
    for (const version of versions) {
      unknown(version as unknown as Record<string, unknown>, fields.history);
      if (
        typeof version.pinned !== "boolean" ||
        !Number.isSafeInteger(version.sort_order) ||
        !(version.title === null || typeof version.title === "string")
      )
        issue("noncanonical-fields");
      const body = content(version.content),
        owner = bodies.get(version.note_id);
      if (!sameProtection(body, owner)) issue("protection-mismatch");
    }
  } catch {
    issue("invalid-payload");
  }
  return {
    eligible: Object.keys(issues).length === 0,
    issues,
    requiredFeatures: [...required].sort(),
    counts,
  };
}

/** Current production capabilities are still zero; eligibility never grants them. */
export function assertCandidateWrite(
  source: string,
  options: {
    runtime: CandidateRuntime;
    expectedId: string;
    capabilities?: SyncCapabilities;
  },
): CandidateReview {
  const bundle = parseSyncJson(source);
  assertSyncCapabilities(bundle, {
    operation: "write",
    requireHeader: true,
    expectedId: options.expectedId,
    capabilities: options.capabilities,
  });
  const review = reviewCandidatePayload(source, options.runtime);
  if (!review.eligible) throw new Error("同步实体不能无损处理，拒绝写入");
  const header = (
    bundle as {
      header: { requires: { readFeatures: string[]; writeFeatures: string[] } };
    }
  ).header;
  for (const feature of review.requiredFeatures) {
    if (
      !header.requires.readFeatures.includes(feature) ||
      !header.requires.writeFeatures.includes(feature)
    )
      throw new Error("同步实体必需特性未完整声明，拒绝写入");
  }
  return review;
}
