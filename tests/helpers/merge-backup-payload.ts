/** Model the storage adapters' merge import for selective Pull tests. */
export function mergeBackupPayload(
  currentSource: string,
  incomingSource: string,
) {
  const current = JSON.parse(currentSource) as Record<string, unknown>;
  const incoming = JSON.parse(incomingSource) as Record<string, unknown>;
  for (const field of [
    "notes",
    "templates",
    "protected_paths",
    "protected_versions",
  ]) {
    if (!Array.isArray(incoming[field])) continue;
    const existing = Array.isArray(current[field])
      ? (current[field] as { id: string }[])
      : [];
    const next = incoming[field] as { id: string }[];
    current[field] = [
      ...new Map(
        [...existing, ...next].map((record) => [record.id, record]),
      ).values(),
    ];
  }
  for (const field of ["config", "user_settings"])
    if (field in incoming) current[field] = incoming[field];
  return JSON.stringify(current);
}
