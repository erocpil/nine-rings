/** Transfer bytes, including wire encoding; bounded between two and ten minutes. */
export function githubTransferTimeoutMs(bytes = 0): number {
  return Math.min(
    600_000,
    120_000 + Math.ceil(Math.max(0, bytes) / 65_536) * 1000,
  );
}
