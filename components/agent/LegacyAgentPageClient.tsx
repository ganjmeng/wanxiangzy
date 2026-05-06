"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Coins, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { ConversationSidebar } from "@/components/agent/ConversationSidebar";
import { ChatArea } from "@/components/agent/ChatArea";
import { InputComposer } from "@/components/agent/InputComposer";
import { CreditLogModal } from "@/components/agent/CreditLogModal";
import { useAgentStore } from "@/lib/store/agent-store";
import { createClient, getCachedProfileCredits, subscribeToProfileCredits } from "@/lib/supabase/client";

export function LegacyAgentPageClient() {
  const router = useRouter();
  const [isAuth, setIsAuth] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [creditLogsOpen, setCreditLogsOpen] = useState(false);

  const s = useAgentStore();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
      } else {
        setIsAuth(true);
        setUserId(data.user.id);
        s.openLanding();
        s.loadConversations();
        getCachedProfileCredits(data.user.id).then(setCredits);
      }
    });

    // 实时监听积分变化
    const unsub = subscribeToProfileCredits(({ credits: c }) => setCredits(c));
    return unsub;
  }, []);

  // 积分刷新：当有生成完成时刷新余额
  useEffect(() => {
    const hasCompleted = s.messages.some(
      (m) => m.generation?.status === "completed" && m.generation?.creditsUsed
    );
    if (hasCompleted && userId) {
      getCachedProfileCredits(userId).then(setCredits);
    }
  }, [s.messages, userId]);

  // Escape 键：关闭侧边栏/灯箱
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (lightbox) setLightbox(null);
        else if (s.sidebarOpen) s.setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox, s.sidebarOpen]);

  useEffect(() => {
    if (!s.activeId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/agent/events?conversationId=${encodeURIComponent(s.activeId)}`);
    const handle = (event: MessageEvent) => {
      try {
        s.receiveAgentEvent(JSON.parse(event.data));
      } catch {}
    };
    source.addEventListener("agent_metric", handle);
    source.addEventListener("brain_trace", handle);
    source.addEventListener("workflow_event", handle);
    return () => source.close();
  }, [s.activeId]);

  if (!isAuth) return null;

  const handleQuickAction = (text: string) => {
    s.setInputText(text);
    // 不自动发送，用户确认后手动点发送
    // 自动聚焦输入框
    setTimeout(() => {
      const textarea = document.querySelector("textarea");
      if (textarea) { textarea.focus(); textarea.setSelectionRange(text.length, text.length); }
    }, 50);
  };

  const focusInput = () => {
    setTimeout(() => {
      const textarea = document.querySelector("textarea");
      if (textarea) textarea.focus();
    }, 50);
  };

  const handleNewConversation = async () => {
    await s.createConversation();
    focusInput();
  };

  const refreshCredits = () => {
    if (userId) {
      getCachedProfileCredits(userId).then(setCredits);
    }
  };

  const recentConversation = [...s.conversations].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  )[0];

  const conv = s.conversations.find((c) => c.id === s.activeId);
  const title = conv?.title || "AI 助手";

  return (
    <div className="studio-workbench min-h-[calc(100dvh-64px)] lg:h-[calc(100vh-64px)] flex flex-col lg:flex-row">
      <FeatureTabs active="agent" />

      <ConversationSidebar
        conversations={s.conversations}
        activeId={s.activeId}
        onCreate={handleNewConversation}
        onSwitch={s.switchConversation}
        onDelete={s.deleteConversation}
        isOpen={s.sidebarOpen}
        onClose={() => s.setSidebarOpen(false)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部栏 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/60 bg-white/80 px-3 py-2 backdrop-blur-xl sm:px-4 sm:gap-3">
          <button onClick={() => s.setSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 lg:hidden">
            <Menu className="h-4 w-4" />
          </button>

          <h1 className="truncate text-sm font-bold text-slate-800">{title}</h1>

          {conv?.mode && (
            <span className={`hidden shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold sm:inline-block ${
              conv.mode === "agent" ? "bg-violet-100 text-violet-600" : "bg-slate-100 text-slate-500"
            }`}>
              {conv.mode === "agent" ? "Agent" : "Chat"}
            </span>
          )}

          <div className="flex-1" />

          {/* 积分余额 */}
          {credits !== null && (
            <button
              type="button"
              onClick={() => setCreditLogsOpen(true)}
              className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-600 transition-colors hover:bg-amber-100"
              title="查看积分流水"
            >
              <Coins className="h-3 w-3" />
              {credits}
            </button>
          )}

          <button onClick={handleNewConversation}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-violet-300 hover:text-violet-600">
            <Plus className="h-3.5 w-3.5" />
            新建
          </button>
        </div>

        {/* 消息区 */}
        <ChatArea
          messages={s.messages}
          sessionImages={s.inputImages}
          isSending={s.isSending}
          onOpenImage={setLightbox}
          onRetry={s.retryMessage}
          onConfirm={s.confirmGeneration}
          onConfirmWorkflow={s.confirmWorkflow}
          onCancelWorkflow={s.cancelWorkflow}
          onRetryWorkflowStep={s.retryWorkflowStep}
          onSkipWorkflowStep={s.skipWorkflowStep}
          onSelectWorkflowStepImage={s.selectWorkflowStepImage}
          onEditWorkflowStep={s.editWorkflowStep}
          onRepair={s.repairGeneration}
          onUpdateConfirmParams={s.updateConfirmParams}
          onUpdateConfirmImageRole={s.updateConfirmImageRole}
          onFeedback={s.sendFeedback}
          onUseAsReference={(url) => {
            s.addReferenceUrl(url);
            toast.success("已加入附件区，可作为参考图使用");
          }}
          recentConversation={recentConversation}
          onContinueRecent={(id) => s.switchConversation(id)}
          onNewConversation={handleNewConversation}
          onOpenHistory={() => s.setSidebarOpen(true)}
          onQuickAction={handleQuickAction}
        />

        {/* 输入区 */}
        <InputComposer
          inputText={s.inputText}
          inputImages={s.inputImages}
          params={s.params}
          intentMode={s.intentMode}
          isSending={s.isSending}
          isAIWriting={s.isAIWriting}
          estimatedCredits={s.params.count * (s.params.model === "gpt-image-2" ? 4 : 3)}
          onTextChange={s.setInputText}
          onAddImages={s.addImages}
          onRemoveImage={s.removeImage}
          onClearImages={s.clearImages}
          onImageRoleChange={s.setImageRole}
          onIntentModeChange={s.setIntentMode}
          onParamsChange={s.setParams}
          onSend={s.sendMessage}
          onAIWrite={s.aiWrite}
          onPreview={setLightbox}
        />
      </div>

      {/* Lightbox — z-[999] 确保在所有元素之上 */}
      <CreditLogModal
        open={creditLogsOpen}
        onClose={() => setCreditLogsOpen(false)}
        onCreditsRefresh={refreshCredits}
      />

      {lightbox && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 p-4 pt-16 backdrop-blur-sm"
          onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 z-[1000] flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          <img src={lightbox} alt="预览" className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}

export default LegacyAgentPageClient;
