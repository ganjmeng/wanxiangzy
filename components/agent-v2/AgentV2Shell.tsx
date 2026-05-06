"use client";

import { useState, type FC } from "react";
import { AssistantRuntimeProvider, useAuiState } from "@assistant-ui/react";
import {
  MenuIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { Thread } from "@/components/thread";
import { ThreadList } from "@/components/thread-list";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { AgentV2GenerationSettingsProvider } from "./AgentV2GenerationSettings";
import { useWanxiangAssistantRuntime } from "./WanxiangAssistantRuntime";

type AgentV2ShellProps = {
  enabled: boolean;
};

export function AgentV2Shell({ enabled }: AgentV2ShellProps) {
  if (!enabled) return <DisabledState />;

  return (
    <AgentV2GenerationSettingsProvider>
      <AgentV2RuntimeBoundary />
    </AgentV2GenerationSettingsProvider>
  );
}

const AgentV2RuntimeBoundary: FC = () => {
  const runtime = useWanxiangAssistantRuntime();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantUI />
    </AssistantRuntimeProvider>
  );
};

const AssistantUI: FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="dark flex h-dvh w-full bg-background text-foreground">
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} />
      </div>
      <MobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
      />
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden transition-[padding] duration-200",
          !sidebarCollapsed && "md:pl-0",
        )}
      >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <Header
            sidebarCollapsed={sidebarCollapsed}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
          <main className="min-h-0 flex-1 overflow-hidden">
            <Thread />
          </main>
        </div>
      </div>
    </div>
  );
};

const Logo: FC = () => {
  return (
    <div className="flex items-center gap-2 px-2 text-sm font-medium">
      <span className="flex size-7 items-center justify-center rounded-xl border bg-background text-foreground shadow-sm">
        <MessageSquareIcon className="size-3.5" />
      </span>
      <span className="text-foreground/90">万象 Agent</span>
    </div>
  );
};

const Sidebar: FC<{ collapsed?: boolean }> = ({ collapsed }) => {
  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-background transition-all duration-200",
        collapsed
          ? "w-0 overflow-hidden opacity-0"
          : "w-[16.25rem] opacity-100",
      )}
    >
      <div className="flex h-full w-[16.25rem] shrink-0 flex-col">
        <div className="flex h-14 shrink-0 items-center px-4">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <ThreadList />
        </div>
      </div>
    </aside>
  );
};

const MobileSidebar: FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="关闭侧边栏"
        className="absolute inset-0 bg-black/15"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 left-0 flex w-[17.5rem] max-w-[82vw] flex-col bg-background shadow-xl">
        <div className="flex h-14 items-center justify-between px-4">
          <Logo />
          <TooltipIconButton tooltip="关闭" onClick={onClose}>
            <XIcon className="size-4" />
          </TooltipIconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <ThreadList />
        </div>
      </aside>
    </div>
  );
};

const Header: FC<{
  sidebarCollapsed: boolean;
  onOpenMobileSidebar: () => void;
  onToggleSidebar: () => void;
}> = ({ sidebarCollapsed, onOpenMobileSidebar, onToggleSidebar }) => {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4">
      <TooltipIconButton
        tooltip="打开菜单"
        onClick={onOpenMobileSidebar}
        className="size-9 md:hidden"
      >
        <MenuIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip={sidebarCollapsed ? "显示侧边栏" : "隐藏侧边栏"}
        side="bottom"
        onClick={onToggleSidebar}
        className="hidden size-9 md:flex"
      >
        <PanelLeftIcon className="size-4" />
      </TooltipIconButton>
      <CurrentThreadTitle />
    </header>
  );
};

const CurrentThreadTitle: FC = () => {
  const title = useAuiState((state) => state.threadListItem.title);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);

  return (
    <div className="min-w-0 flex-1 md:flex-none">
      <div className="truncate text-sm font-medium text-foreground">
        {remoteId ? title || "新对话" : "新对话"}
      </div>
      <div className="hidden truncate text-xs text-muted-foreground sm:block">
        Agent 会理解图片和文字，必要时先规划再确认
      </div>
    </div>
  );
};

function DisabledState() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4">
      <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-muted">
          <SparklesIcon className="size-6 text-muted-foreground" />
        </div>
        <h1 className="text-base font-semibold text-foreground">
          Agent v2 未启用
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          开启 Agent UI 开关后，可以使用 assistant-ui 和 AI SDK 驱动的新体验。
        </p>
      </div>
    </div>
  );
}
