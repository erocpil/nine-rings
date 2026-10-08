import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNearViewport } from "../hooks/useNearViewport";
const FlowBlockContent = lazy(() =>
  import("./FlowBlockContent").then((module) => ({
    default: module.FlowBlockContent,
  })),
);

export function DeferredFlowBlock({
  source,
  visible = true,
}: {
  source: string;
  visible?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const near = useNearViewport(host);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (near && visible) setActive(true);
  }, [near, visible]);
  return (
    <div
      ref={host}
      className="flow-block-preview"
      hidden={!visible}
      contentEditable={false}
    >
      {active && (
        <Suspense fallback={<div role="status">正在加载流程…</div>}>
          <FlowBlockContent source={source} />
        </Suspense>
      )}
    </div>
  );
}
