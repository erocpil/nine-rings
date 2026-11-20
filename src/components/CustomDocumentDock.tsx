import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type DocumentDockLayout,
  type DockPanel,
  visibleDockGroups,
} from "../lib/document-dock-layout";
import type { DesktopDocumentPanelController } from "../hooks/useDesktopDocumentPanels";

interface Props {
  controller: DesktopDocumentPanelController;
  layout: DocumentDockLayout;
  panels: Record<DockPanel, ReactNode>;
  labels: Record<DockPanel, string>;
  hint(panel: DockPanel): string | undefined;
}

export function CustomDocumentDock({
  controller,
  layout,
  panels,
  labels,
  hint,
}: Props) {
  const groups = visibleDockGroups(layout, (panel) => Boolean(panels[panel]));
  const visibleWeight = groups.reduce(
    (total, group) => total + group.weight,
    0,
  );
  const prefix = useId();
  const [resize, setResize] = useState<{
    index: number;
    weight: number;
    next: number;
    nextWeight: number;
  }>();
  const pointer = useRef<{
    id: number;
    top: number;
    height: number;
    total: number;
    start: number;
  }>();
  useEffect(() => {
    pointer.current = undefined;
    setResize(undefined);
  }, [layout]);
  const keepSizes = (value: NonNullable<typeof resize>) =>
    controller.changeDock((current) =>
      current === undefined
        ? current
        : {
            ...current,
            groups: current.groups.map((group, index) =>
              index === value.index
                ? { ...group, weight: value.weight }
                : index === value.next
                  ? { ...group, weight: value.nextWeight }
                  : group,
            ),
          },
    );
  const sizes = (index: number, next: number, total: number, ratio: number) => {
    const weight = total * Math.max(0.15, Math.min(0.85, ratio));
    return { index, next, weight, nextWeight: total - weight };
  };
  return (
    <div className="document-dock-custom">
      {groups.map((group, index) => {
        const next = groups[index + 1];
        const weight =
          resize?.index === group.index
            ? resize.weight
            : resize?.next === group.index
              ? resize.nextWeight
              : group.weight;
        const total = next ? group.weight + next.weight : 1;
        const ratio = group.weight / total;
        return (
          <Fragment key={layout.groups[group.index].panels[0]}>
            <section
              className="document-dock-group"
              data-dock-target={group.active}
              data-dock-peer={group.panels.find(
                (panel) => panel !== group.active,
              )}
              data-dock-drop={hint(group.active)}
              style={{ flexGrow: weight / visibleWeight }}
            >
              {group.panels.length > 1 && (
                <div
                  className="document-dock-tabs"
                  role="tablist"
                  aria-label="导航面板标签"
                >
                  {group.panels.map((panel, tabIndex) => (
                    <button
                      type="button"
                      key={panel}
                      id={prefix + "-tab-" + panel}
                      role="tab"
                      data-dock-panel={panel}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Alt+Enter"
                      aria-selected={group.active === panel}
                      aria-controls={prefix + "-panel-" + panel}
                      tabIndex={group.active === panel ? 0 : -1}
                      title={labels[panel]}
                      onPointerDown={(event) =>
                        controller.startDockDrag(panel, event.nativeEvent)
                      }
                      onClick={() => controller.showDockPanel(panel)}
                      onKeyDown={(event) => {
                        const last = group.panels.length - 1;
                        const target =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? last
                              : event.key === "ArrowLeft"
                                ? (tabIndex + last) % group.panels.length
                                : event.key === "ArrowRight"
                                  ? (tabIndex + 1) % group.panels.length
                                  : -1;
                        if (target < 0) return;
                        event.preventDefault();
                        const panel = group.panels[target];
                        if (controller.showDockPanel(panel))
                          document
                            .getElementById(prefix + "-tab-" + panel)
                            ?.focus();
                      }}
                    >
                      {labels[panel]}
                    </button>
                  ))}
                </div>
              )}
              {group.panels.map((panel) => (
                <div
                  key={panel}
                  className="document-panel-slot document-dock-content"
                  data-panel={panel}
                  id={prefix + "-panel-" + panel}
                  role={group.panels.length > 1 ? "tabpanel" : undefined}
                  aria-labelledby={
                    group.panels.length > 1
                      ? prefix + "-tab-" + panel
                      : undefined
                  }
                  hidden={group.active !== panel}
                >
                  {panels[panel]}
                </div>
              ))}
            </section>
            {next && (
              <div
                className="document-panel-divider document-dock-splitter"
                role="separator"
                tabIndex={0}
                aria-label="调整固定面板高度"
                aria-orientation="horizontal"
                aria-valuemin={15}
                aria-valuemax={85}
                aria-valuenow={Math.round(
                  100 *
                    (resize?.index === group.index
                      ? resize.weight / total
                      : ratio),
                )}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  const splitter = event.currentTarget;
                  const above =
                      splitter.previousElementSibling?.getBoundingClientRect(),
                    below =
                      splitter.nextElementSibling?.getBoundingClientRect();
                  if (!above || !below) return;
                  pointer.current = {
                    id: event.pointerId,
                    top: above.top + event.clientY - above.bottom,
                    height: above.height + below.height,
                    total,
                    start: event.clientY,
                  };
                  splitter.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = pointer.current;
                  if (drag?.id !== event.pointerId) return;
                  setResize(
                    sizes(
                      group.index,
                      next.index,
                      drag.total,
                      (event.clientY - drag.top) / Math.max(1, drag.height),
                    ),
                  );
                }}
                onPointerUp={(event) => {
                  const drag = pointer.current;
                  if (drag?.id !== event.pointerId) return;
                  pointer.current = undefined;
                  if (event.clientY !== drag.start) {
                    keepSizes(
                      sizes(
                        group.index,
                        next.index,
                        drag.total,
                        (event.clientY - drag.top) / Math.max(1, drag.height),
                      ),
                    );
                  }
                  setResize(undefined);
                }}
                onLostPointerCapture={() => {
                  pointer.current = undefined;
                  setResize(undefined);
                }}
                onKeyDown={(event) => {
                  const target =
                    event.key === "Home"
                      ? 0.15
                      : event.key === "End"
                        ? 0.85
                        : event.key === "ArrowUp"
                          ? ratio - 0.05
                          : event.key === "ArrowDown"
                            ? ratio + 0.05
                            : undefined;
                  if (target === undefined) return;
                  event.preventDefault();
                  keepSizes(sizes(group.index, next.index, total, target));
                }}
              />
            )}
          </Fragment>
        );
      })}
      <button
        className="document-dock-reset"
        type="button"
        onClick={() => controller.changeDock(() => undefined)}
      >
        恢复默认面板布局
      </button>
    </div>
  );
}
