import type { ReactNode } from "react";

import { CanvasAppProviders } from "./canvas-app-providers";

export default function InfiniteCanvasLayout({ children }: { children: ReactNode }) {
  return <CanvasAppProviders>{children}</CanvasAppProviders>;
}
