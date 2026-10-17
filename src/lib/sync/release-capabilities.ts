/** Certified format and feature profile advertised by Web/Tauri 0.3.0. */
import type { SyncCapabilities } from "./protocol-capabilities";
export const MINIMUM_SYNC_CLIENT_VERSION = "0.3.0";
export function supportedSyncParticipantVersion(version: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  const minimum = MINIMUM_SYNC_CLIENT_VERSION.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
}
const features = [
  "app-config-v1",
  "automatic-toc-v1",
  "block-image-v1",
  "bundled-image-v1",
  "composed-inline-v1",
  "document-bookmarks-v1",
  "document-links-v1",
  "document-metadata-v1",
  "encrypted-document-v1",
  "flow-block-v1",
  "footnotes-v1",
  "frontend-settings-v1",
  "github-alert-v1",
  "hard-break-v1",
  "horizontal-rule-v1",
  "inert-html-v1",
  "inline-appearance-v1",
  "inline-image-v1",
  "math-v1",
  "mermaid-block-v1",
  "protected-history-v1",
  "protected-path-v1",
  "reference-anchors-v1",
  "restricted-html-v1",
  "structured-block-v1",
  "structured-text-v1",
  "table-block-v1",
  "template-metadata-v1",
  "text-document-v1",
];
export const RELEASE_SYNC_CAPABILITIES: SyncCapabilities = Object.freeze({
  formats: Object.freeze([1]),
  codecs: Object.freeze([1]),
  read: 1,
  write: 1,
  readFeatures: Object.freeze(features),
  writeFeatures: Object.freeze([...features]),
});
