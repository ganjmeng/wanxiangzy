import type { Metadata } from "next";
import { CreativePlaza } from "@/features/creative-plaza/CreativePlaza";

export const metadata: Metadata = {
  title: "创作广场",
  description: "浏览精选视觉案例，一键带入 Agent 创作。",
};

export default function PlazaPage() {
  return <CreativePlaza />;
}
