import { Mastra } from "@mastra/core";
import { directChatAgent, mainAgent } from "@/lib/mastra/agents/main-agent";

export const mastra = new Mastra({
  agents: {
    directChatAgent,
    mainAgent,
  },
});
