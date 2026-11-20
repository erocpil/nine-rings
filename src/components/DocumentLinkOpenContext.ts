import { createContext } from "react";

export const DocumentLinkOpenContext = createContext<{
  canOpen: (href: string) => boolean;
  open: (href: string) => void;
} | null>(null);
