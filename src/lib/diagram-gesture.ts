export type DiagramPoint = { x: number; y: number };
export type DiagramView = { scale: number; x: number; y: number };
export function touchCenter(a: DiagramPoint, b: DiagramPoint): DiagramPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
export function pinchScale(
  scale: number,
  a: DiagramPoint,
  b: DiagramPoint,
  nextA: DiagramPoint,
  nextB: DiagramPoint,
): number {
  const initialDistance = Math.hypot(a.x - b.x, a.y - b.y);
  if (initialDistance < 1) return scale;
  return Math.max(
    0.25,
    Math.min(
      8,
      (scale * Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y)) /
        initialDistance,
    ),
  );
}
/** Calculate zoom and translation together, before viewport clamping. */
export function pinchView(
  view: DiagramView,
  a: DiagramPoint,
  b: DiagramPoint,
  nextA: DiagramPoint,
  nextB: DiagramPoint,
  viewportCenter: DiagramPoint,
): DiagramView {
  const start = touchCenter(a, b),
    end = touchCenter(nextA, nextB);
  const scale = pinchScale(view.scale, a, b, nextA, nextB);
  const ratio = scale / view.scale;
  return {
    scale,
    x: end.x - viewportCenter.x - (start.x - viewportCenter.x - view.x) * ratio,
    y: end.y - viewportCenter.y - (start.y - viewportCenter.y - view.y) * ratio,
  };
}
