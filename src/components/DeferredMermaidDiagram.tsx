import { useEffect, useRef, useState } from "react";
import { useNearViewport } from "../hooks/useNearViewport";
import { MermaidDiagram } from "./MermaidDiagram";

/** Shared by editable and virtual readonly blocks. Once activated, retain the
 * diagram so scrolling cannot collapse its measured height or discard state. */
export function DeferredMermaidDiagram({ source, visible = true }: { source: string; visible?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const near = useNearViewport(host);
  const [activated, setActivated] = useState(false);
  useEffect(() => { if (near && visible) setActivated(true); }, [near, visible]);
  return <div ref={host} className="deferred-mermaid-diagram" hidden={!visible}>
    {activated ? <MermaidDiagram source={source} /> : <div style={{ minHeight: 180 }} aria-label="图形将在接近可视区时加载" />}
  </div>;
}
