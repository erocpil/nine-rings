import { isMacPlatform } from "./shortcuts";

export interface DocumentOpenOptions {
  view?: "source";
}
type OpenClick = {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** macOS Control-click remains a native context-menu gesture. */
export function documentOpenOptions(
  event: OpenClick,
  platform?: string,
): DocumentOpenOptions | undefined {
  const primary = isMacPlatform(platform) ? event.metaKey : event.ctrlKey;
  return event.button === 0 && primary && !event.altKey && !event.shiftKey
    ? { view: "source" }
    : undefined;
}
