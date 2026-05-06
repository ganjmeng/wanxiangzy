import { AgentV2Shell } from "@/components/agent-v2/AgentV2Shell";
import { isAgentV2UiEnabled } from "@/lib/agent-v2/config";

export default function AgentV2Page() {
  return <AgentV2Shell enabled={isAgentV2UiEnabled()} />;
}
