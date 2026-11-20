export type DockPanel = "outline" | "bookmark" | "matches";
export type DockDrop = "before" | "tab" | "after";

export interface DockGroup {
  panels: DockPanel[];
  active: DockPanel;
  weight: number;
}

export interface DocumentDockLayout {
  groups: DockGroup[];
  closed: DockPanel[];
}

export function isDockPanel(value: unknown): value is DockPanel {
  return value === "outline" || value === "bookmark" || value === "matches";
}

export function normalizeDocumentDock(
  value: unknown,
): DocumentDockLayout | undefined {
  const raw = value as Partial<DocumentDockLayout> | undefined;
  if (!Array.isArray(raw?.groups)) return;
  const seen = new Set<DockPanel>();
  const groups: DockGroup[] = [];
  for (const item of raw.groups) {
    if (!Array.isArray(item?.panels)) continue;
    const panels = item.panels.filter((panel) => {
      if (!isDockPanel(panel) || seen.has(panel)) return false;
      seen.add(panel);
      return true;
    });
    if (!panels.length) continue;
    groups.push({
      panels,
      active: panels.includes(item.active) ? item.active : panels[0],
      weight:
        typeof item.weight === "number" && Number.isFinite(item.weight)
          ? Math.max(0.01, Math.min(12, item.weight))
          : 1,
    });
  }
  if (!groups.length) return;
  return {
    groups,
    closed: Array.isArray(raw.closed)
      ? [...new Set(raw.closed.filter((panel) => seen.has(panel)))]
      : [],
  };
}

export function visibleDockGroups(
  layout: DocumentDockLayout,
  available: (panel: DockPanel) => boolean,
) {
  return layout.groups.flatMap((group, index) => {
    const panels = group.panels.filter(
      (panel) => available(panel) && !layout.closed.includes(panel),
    );
    return panels.length
      ? [
          {
            ...group,
            index,
            panels,
            active: panels.includes(group.active) ? group.active : panels[0],
          },
        ]
      : [];
  });
}

export function openDockPanel(
  layout: DocumentDockLayout,
  panel: DockPanel,
  close = false,
): DocumentDockLayout {
  const group = layout.groups.find((item) => item.panels.includes(panel));
  if (close)
    return { ...layout, closed: [...new Set([...layout.closed, panel])] };
  const groups = group
    ? layout.groups.map((item) =>
        item === group ? { ...item, active: panel } : item,
      )
    : [...layout.groups, { panels: [panel], active: panel, weight: 1 }];
  return { groups, closed: layout.closed.filter((item) => item !== panel) };
}

export function moveDockPanel(
  layout: DocumentDockLayout,
  panel: DockPanel,
  target: DockPanel,
  drop: DockDrop,
): DocumentDockLayout {
  const destination = layout.groups.find((group) =>
    group.panels.includes(target),
  );
  if (
    !destination ||
    panel === target ||
    (drop === "tab" && destination.panels.includes(panel))
  )
    return layout;
  const removed = layout.groups.find((group) => group.panels.includes(panel));
  const groups = layout.groups.flatMap((group) => {
    const panels = group.panels.filter((item) => item !== panel);
    if (!panels.length) return [];
    const next = {
      ...group,
      panels,
      active: panels.includes(group.active) ? group.active : panels[0],
    };
    if (group !== destination) return [next];
    if (drop === "tab")
      return [{ ...next, panels: [...panels, panel], active: panel }];
    const weight =
      removed?.panels.length === 1 ? removed.weight : next.weight / 2;
    if (removed?.panels.length !== 1) next.weight = weight;
    const added = { panels: [panel], active: panel, weight };
    return drop === "before" ? [added, next] : [next, added];
  });
  return { groups, closed: layout.closed.filter((item) => item !== panel) };
}
