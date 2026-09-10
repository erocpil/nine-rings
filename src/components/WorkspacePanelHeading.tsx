import { forwardRef, type ReactNode } from "react";
import "./WorkspacePanelHeading.css";

/** Shared panel chrome; each workspace owns the content below this header. */
export const WorkspacePanelHeading = forwardRef<HTMLElement, {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
  tabIndex?: number;
}>(function WorkspacePanelHeading({ title, children, className = "", tabIndex }, ref) {
  return <header ref={ref} tabIndex={tabIndex} className={`workspace-panel-heading ${className}`}>
    {typeof title === "string" ? <span className="workspace-panel-title">{title}</span> : title}
    <span className="workspace-panel-spacer" />
    {children}
  </header>;
});
