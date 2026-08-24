import type { Metadata } from "next";
import { InfiniteCanvasEditor } from "@/features/infinite-canvas/InfiniteCanvasEditor";

export const metadata: Metadata = { title: "无限画布" };

export default async function CanvasProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InfiniteCanvasEditor projectId={id} />;
}
