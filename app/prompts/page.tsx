import type { Metadata } from "next";
import { ResourceLibraryPage } from "@/features/resource-library/ResourceLibraryPage";

export const metadata: Metadata = {
  title: "提示词",
  description: "管理个人提示词并从创作词库开始。",
};

export default function PromptsPage() {
  return <ResourceLibraryPage initialTab="prompts" />;
}
