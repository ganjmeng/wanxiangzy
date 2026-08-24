import type { Metadata } from "next";
import { CanvasLibrary } from "@/features/infinite-canvas/CanvasLibrary";

export const metadata: Metadata = {
  title: "无限画布",
  description: "自由组织灵感、提示词、素材和生成结果。",
};

export default function CanvasPage() {
  return <CanvasLibrary />;
}
