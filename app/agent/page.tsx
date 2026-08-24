import type { Metadata } from "next";
import { AgentExperience } from "@/features/creative-agent/AgentExperience";

export const metadata: Metadata = {
  title: "创作 Agent",
  description: "从一个想法开始，调用现有模型、积分和任务系统完成视觉创作。",
};

export default function AgentPage() {
  return <AgentExperience />;
}
