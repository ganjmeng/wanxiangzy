import {
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/attachment";
import { AgentInlineActivity } from "@/components/agent-v2/AgentInlineActivity";
import { AgentThinkingLine } from "@/components/agent-v2/AgentThinkingIndicator";
import {
  useAgentV2GenerationSettings,
  type AgentV2AppModule,
  type AgentV2Mode,
  type AgentV2Speed,
} from "@/components/agent-v2/AgentV2GenerationSettings";
import { MarkdownText } from "@/components/markdown-text";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/reasoning";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/tool-group";
import { ToolFallback } from "@/components/tool-fallback";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  isQuietAgentTool,
  shouldRenderAssistantPart,
  shouldRenderToolInline,
  shouldRenderToolProcessPanel,
} from "@/lib/agent-v2/chat-ui-policy";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AtSignIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CopyIcon,
  DownloadIcon,
  FileClockIcon,
  GlobeIcon,
  ImageIcon,
  ImagePlusIcon,
  Layers3Icon,
  LightbulbIcon,
  MoreHorizontalIcon,
  BotIcon,
  Grid2X2Icon,
  MicIcon,
  MessageCircleIcon,
  PaletteIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  ShirtIcon,
  ShoppingBagIcon,
  SparklesIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserIcon,
  WandSparklesIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ElementType,
  type FC,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

type PromptChip = {
  title: string;
  description?: string;
  prompt: string;
  icon: ElementType;
};

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "48rem",
        ["--composer-radius" as string]: "22px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="bottom"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth bg-background"
      >
        <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col px-4 pt-4">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-10 flex flex-col gap-y-8 empty:hidden"
          >
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
                EditComposer,
              }}
            />
          </div>
          <AgentInlineActivity />

          <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mt-auto flex flex-col gap-3 overflow-visible rounded-t-[var(--composer-radius)] bg-background/95 pb-4 md:pb-5">
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom
      render={
        <TooltipIconButton
          tooltip="回到底部"
          variant="outline"
          className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
        />
      }
    >
      <ArrowDownIcon />
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root my-auto flex grow flex-col justify-center gap-7 pb-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-2 text-center">
        <div className="mb-5 flex size-11 items-center justify-center rounded-2xl border bg-background shadow-sm">
          <SparklesIcon className="size-5 text-emerald-600" />
        </div>
        <h1 className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-semibold text-3xl tracking-normal duration-200 md:text-4xl">
          今天想做什么？
        </h1>
        <p className="mt-3 max-w-lg text-muted-foreground text-sm leading-7 md:text-base">
          直接说目标或上传图片。我会先理解上下文，普通问题直接回答，涉及生成、扣积分或工作流时再给你确认。
        </p>
      </div>

      <PromptChips
        prompts={WELCOME_PROMPTS}
        className="mx-auto max-w-2xl px-2 pb-4"
      />
    </div>
  );
};

const ComposerQuickActions: FC = () => {
  const aui = useAui();
  const hasDraftText = useAuiState((s) => s.composer.text.trim().length > 0);
  const hasAttachments = useAuiState((s) => s.composer.attachments.length > 0);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  if (hasDraftText || hasAttachments || isRunning) return null;

  return (
    <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 px-1">
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => aui.composer().setText("/")}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <SparklesIcon className="size-3.5" />
          快捷指令
          <ChevronDownIcon className="size-3.5" />
        </button>
        <PromptChips prompts={COMPOSER_QUICK_PROMPTS} compact />
      </div>
    </div>
  );
};

const PromptChips: FC<{
  prompts: PromptChip[];
  compact?: boolean;
  className?: string;
}> = ({ prompts, compact = false, className }) => {
  const aui = useAui();
  const disabled = useAuiState(
    (s) => s.thread.isDisabled || s.thread.isRunning,
  );

  const sendPrompt = (prompt: string) => {
    if (disabled) return;
    aui.thread().append({
      content: [{ type: "text", text: prompt }],
      runConfig: aui.composer().getState().runConfig,
    });
  };

  return (
    <div
      className={cn(
        compact
          ? "flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "grid w-full gap-2 @md:grid-cols-2",
        className,
      )}
    >
      {prompts.map((item) => (
        <button
          key={item.title}
          type="button"
          disabled={disabled}
          onClick={() => sendPrompt(item.prompt)}
          className={cn(
            "fade-in slide-in-from-bottom-2 animate-in border bg-background text-left text-sm shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50",
            compact
              ? "inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-muted-foreground shadow-none"
              : "flex min-h-[4rem] items-start gap-3 rounded-2xl px-4 py-3",
          )}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
              compact ? "size-6" : "mt-0.5 size-8",
            )}
          >
            <item.icon className={compact ? "size-3.5" : "size-4"} />
          </span>
          <span className="min-w-0 whitespace-nowrap font-medium text-foreground">
            {item.title}
            {!compact && item.description ? (
              <span className="mt-0.5 block whitespace-normal text-muted-foreground text-xs font-normal leading-5">
                {item.description}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
};

const WELCOME_PROMPTS = [
  {
    title: "分析图片",
    description: "先看清图片内容、角色关系和可做方向。",
    prompt: "先分析我上传的图片，判断内容、角色关系和适合做的视觉任务，不要直接生成。",
    icon: LightbulbIcon,
  },
  {
    title: "自由生成",
    description: "说目标即可，不需要先选固定模板。",
    prompt: "根据我的目标自由设计一张商业可用的视觉图，先给我确认方案。",
    icon: SparklesIcon,
  },
  {
    title: "服装换装",
    description: "人物图、服装图、参考图都可以组合说明。",
    prompt: "帮我把服装图穿到人物图上，保持人物身份、服装结构和比例准确，先给我确认方案。",
    icon: ShirtIcon,
  },
  {
    title: "电商详情页",
    description: "围绕卖点、场景和版式生成素材方案。",
    prompt: "根据我上传的商品或服装图片，生成一套适合淘宝/天猫详情页的素材方案，先给我确认。",
    icon: ImageIcon,
  },
] satisfies PromptChip[];

const COMPOSER_QUICK_PROMPTS = [
  {
    title: "分析图片",
    prompt: "先分析我上传的图片，判断每张图的角色和适合做的生成任务。",
    icon: LightbulbIcon,
  },
  {
    title: "自由生成",
    prompt: "根据我的目标自由设计一张商业可用的图片，先给我确认方案。",
    icon: WandSparklesIcon,
  },
  {
    title: "换装",
    prompt: "把服装图穿到人物图上，保持人物身份、服装结构和比例准确。",
    icon: ShirtIcon,
  },
] satisfies PromptChip[];

const EXPANDED_COMMAND_PROMPTS = [
  {
    title: "你能做什么？",
    description: "先聊能力边界和推荐流程，不创建任务。",
    prompt: "你能做什么？请按聊天、图片分析、生成任务、工作流执行分别说明。",
    icon: SparklesIcon,
  },
  {
    title: "先问我关键问题",
    description: "目标不清楚时，让 Agent 追问，不要误判。",
    prompt: "先根据我上传的图片和描述，问我最关键的 1-3 个问题，不要直接生成。",
    icon: LightbulbIcon,
  },
  {
    title: "图生图优化",
    description: "保留主体，重做画面质感或商业表达。",
    prompt: "基于我上传的图做图生图优化，保留主体和关键结构，先给我确认方案。",
    icon: ImageIcon,
  },
  {
    title: "淘宝详情页",
    description: "按商品详情页素材思路规划，不自动归类为种草图。",
    prompt:
      "基于这些图片生成一套淘宝/天猫详情页素材，先分析卖点、版式和所需分镜。",
    icon: ImageIcon,
  },
  {
    title: "每张单独出图",
    description: "适合多姿势、多场景，不拼成四宫格。",
    prompt: "这次生成多张图片时，请每张单独出图，不要四宫格拼图。",
    icon: WandSparklesIcon,
  },
  {
    title: "3D 展示方案",
    description: "先判断素材是否适合做服装 3D 展示。",
    prompt: "先分析这件服装是否适合做 3D 展示，并给我可执行的 3D 生成方案。",
    icon: ShirtIcon,
  },
] satisfies PromptChip[];

const Composer: FC = () => {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const attachments = useAuiState((s) => s.composer.attachments);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedTriggerKey, setDismissedTriggerKey] = useState("");

  const trigger = useMemo(() => getComposerTrigger(text), [text]);
  const triggerKey = trigger
    ? `${trigger.type}:${trigger.start}:${trigger.query}`
    : "";
  const menuItems = useMemo(
    () => getComposerMenuItems(trigger, attachments),
    [attachments, trigger],
  );
  const menuOpen =
    Boolean(trigger) &&
    triggerKey !== dismissedTriggerKey &&
    menuItems.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [triggerKey, menuItems.length]);

  useEffect(() => {
    if (text === "/" || text === "@") {
      const timeout = window.setTimeout(() => {
        if (aui.composer().getState().text === text) {
          aui.composer().setText("");
        }
      }, 1200);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [aui, text]);

  const applyItem = useCallback(
    (item: ComposerMenuItem) => {
      if (!trigger) return;
      aui
        .composer()
        .setText(replaceComposerTrigger(text, trigger, item.insertText));
      setDismissedTriggerKey("");
    },
    [aui, text, trigger],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!menuOpen) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % menuItems.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + menuItems.length) % menuItems.length,
        );
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyItem(menuItems[activeIndex] ?? menuItems[0]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setDismissedTriggerKey(triggerKey);
      }
    },
    [activeIndex, applyItem, menuItems, menuOpen, triggerKey],
  );

  const focusInputFromShell = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest(
        "button,a,input,textarea,select,[role='button'],[data-no-composer-focus='true']",
      )
    ) {
      return;
    }

    const input = event.currentTarget.querySelector<HTMLTextAreaElement>(
      ".aui-composer-input",
    );
    window.requestAnimationFrame(() => input?.focus());
  }, []);

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col">
      <ComposerCommandMenu
        open={menuOpen}
        items={menuItems}
        activeIndex={activeIndex}
        triggerType={trigger?.type}
        onHover={setActiveIndex}
        onSelect={applyItem}
      />
      <ComposerPrimitive.AttachmentDropzone
        render={
          <div
            data-slot="aui_composer-shell"
            onMouseDown={focusInputFromShell}
            className="flex w-full flex-col gap-2 rounded-[var(--composer-radius)] border bg-card p-[var(--composer-padding)] shadow-sm transition-shadow focus-within:border-ring/75 focus-within:shadow-lg focus-within:ring-2 focus-within:ring-ring/15 data-[dragging=true]:border-dashed data-[dragging=true]:border-ring data-[dragging=true]:bg-accent/50 dark:bg-[#303030] dark:shadow-none"
          />
        }
      >
        <ComposerAttachments />
        <ComposerTextarea
          placeholder="描述任务"
          onKeyDown={handleKeyDown}
        />
        <ComposerAttachmentStatus />
        <ComposerAction />
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerTextarea: FC<{
  placeholder: string;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}> = ({ placeholder, onKeyDown }) => {
  const aui = useAui();
  const composerText = useAuiState((s) => s.composer.text);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const attachmentsCount = useAuiState((s) => s.composer.attachments.length);
  const [draft, setDraft] = useState(composerText);

  useEffect(() => {
    setDraft(composerText);
  }, [composerText]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const nextText = event.currentTarget.value;
      setDraft(nextText);
      aui.composer().setText(nextText);
    },
    [aui],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown(event);
      if (event.defaultPrevented) return;

      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const canSend = draft.trim().length > 0 || attachmentsCount > 0;
        if (!isRunning && canSend) {
          document.querySelector<HTMLButtonElement>(".aui-composer-send")?.click();
        }
      }
    },
    [attachmentsCount, draft, isRunning, onKeyDown],
  );

  return (
    <textarea
      name="input"
      placeholder={placeholder}
      autoFocus
      rows={2}
      aria-label="消息输入"
      value={draft}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      className="aui-composer-input max-h-32 min-h-14 w-full resize-none bg-transparent px-[0.4375rem] py-1 text-sm text-foreground caret-foreground outline-none placeholder:text-muted-foreground/80 dark:text-white dark:placeholder:text-zinc-400"
    />
  );
};

const ComposerAttachmentStatus: FC = () => {
  const summary = useComposerAttachmentStatus();

  if (!summary.total) return null;

  if (summary.failed > 0) {
    return (
      <div className="px-[0.4375rem] text-xs text-destructive">
        有 {summary.failed} 张图片上传失败，请移除后重新上传。
      </div>
    );
  }

  if (summary.uploading > 0) {
    return (
      <div className="flex items-center gap-2 px-[0.4375rem] text-xs text-muted-foreground">
        <span className="size-3 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground" />
        图片准备中，完成后即可发送
        {summary.uploading > 1 ? `（${summary.uploading} 张）` : ""}
      </div>
    );
  }

  return null;
};

type ComposerTrigger =
  | { type: "slash"; query: string; start: number; end: number }
  | { type: "mention"; query: string; start: number; end: number };

type ComposerMenuItem = {
  id: string;
  title: string;
  description: string;
  insertText: string;
  icon: ElementType;
};

const SLASH_COMMANDS: ComposerMenuItem[] = [
  {
    id: "analyze-images",
    title: "/分析图片",
    description: "先理解图片内容和关系，不直接生成",
    insertText:
      "先分析我上传的图片，判断每张图的角色、关系和适合做的视觉任务。",
    icon: LightbulbIcon,
  },
  {
    id: "ask-first",
    title: "/先追问",
    description: "目标不清楚时只问关键问题",
    insertText:
      "如果我的目标不够清楚，请先问我最关键的 1-3 个问题，不要直接生成。",
    icon: SparklesIcon,
  },
  {
    id: "try-on",
    title: "/服装换装",
    description: "人物穿参考服装，保持身份和结构",
    insertText:
      "帮我把服装图穿到人物图上，保持人物身份、服装结构、比例和材质准确，先给我确认方案。",
    icon: ShirtIcon,
  },
  {
    id: "pose-variation",
    title: "/姿势裂变",
    description: "生成自然姿势变化，可单张输出",
    insertText:
      "基于人物图生成自然可信的姿势变化；如果生成多张，请每张单独出图，先给我确认计划。",
    icon: WandSparklesIcon,
  },
  {
    id: "detail-page",
    title: "/淘宝详情页",
    description: "按详情页素材规划，不误判成种草图",
    insertText:
      "基于这些图片生成一套淘宝/天猫详情页素材，先分析商品卖点、版式结构和所需分镜。",
    icon: ImageIcon,
  },
  {
    id: "free-create",
    title: "/自由创作",
    description: "让 Agent 根据目标自由发挥",
    insertText: "根据我的目标自由设计一张商业可用的图片，先给我确认方案。",
    icon: SparklesIcon,
  },
  {
    id: "three-d",
    title: "/3D展示",
    description: "先判断素材是否适合 3D 展示",
    insertText:
      "先分析这些素材是否适合做 3D 展示，并给我可执行的 3D 生成方案。",
    icon: ShirtIcon,
  },
];

function getComposerTrigger(text: string): ComposerTrigger | null {
  const match = /(^|\s)([\/@])([^\s\/@]*)$/.exec(text);
  if (!match) return null;

  const start = match.index + match[1].length;
  return {
    type: match[2] === "/" ? "slash" : "mention",
    query: match[3] || "",
    start,
    end: text.length,
  };
}

function getComposerMenuItems(
  trigger: ComposerTrigger | null,
  attachments: readonly unknown[],
) {
  if (!trigger) return [];
  const query = trigger.query.trim().toLowerCase();

  if (trigger.type === "slash") {
    return SLASH_COMMANDS.filter((item) =>
      [item.title, item.description, item.insertText]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  return attachments
    .map((attachment, index) => ({
      id: `image-${index + 1}`,
      title: `@图${index + 1}`,
      description: readAttachmentName(attachment) || "当前上传图片",
      insertText: `@图${index + 1} `,
      icon: AtSignIcon,
    }))
    .filter((item) =>
      [item.title, item.description].join(" ").toLowerCase().includes(query),
    );
}

function replaceComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
  insertText: string,
) {
  const suffix = insertText.endsWith(" ") ? "" : " ";
  return `${text.slice(0, trigger.start)}${insertText}${suffix}${text.slice(
    trigger.end,
  )}`;
}

function readAttachmentName(attachment: unknown) {
  if (!attachment || typeof attachment !== "object") return "";
  const name = (attachment as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function useComposerAttachmentStatus() {
  const total = useAuiState((s) => s.composer.attachments.length);
  const uploading = useAuiState((s) =>
    countComposerAttachmentsByStatus(s.composer.attachments, "running"),
  );
  const failed = useAuiState((s) =>
    countComposerAttachmentsByStatus(s.composer.attachments, "incomplete"),
  );

  return { total, uploading, failed };
}

function countComposerAttachmentsByStatus(
  attachments: readonly unknown[],
  targetStatus: string,
) {
  let count = 0;

  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const status = (attachment as { status?: unknown }).status;
    if (!status || typeof status !== "object") continue;
    const type = (status as { type?: unknown }).type;
    if (type === targetStatus) count += 1;
  }

  return count;
}

const ComposerCommandMenu: FC<{
  open: boolean;
  items: ComposerMenuItem[];
  activeIndex: number;
  triggerType?: ComposerTrigger["type"];
  onHover: (index: number) => void;
  onSelect: (item: ComposerMenuItem) => void;
}> = ({ open, items, activeIndex, triggerType, onHover, onSelect }) => {
  if (!open) return null;

  return (
    <div className="absolute right-0 bottom-full left-0 z-40 mb-2 overflow-hidden rounded-2xl border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span>{triggerType === "mention" ? "引用图片" : "快捷指令"}</span>
        <span>↑ ↓ 选择 · Enter 插入 · Esc 关闭</span>
      </div>
      <div className="max-h-72 overflow-y-auto p-1">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            className={cn(
              "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
              index === activeIndex ? "bg-muted" : "hover:bg-muted/70",
            )}
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
              <item.icon className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                {item.title}
              </span>
              <span className="line-clamp-1 text-muted-foreground text-xs">
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

function getAppModuleLabel(module: AgentV2AppModule) {
  const labels: Record<AgentV2AppModule, string> = {
    auto: "应用",
    image_analysis: "图片分析",
    image_create: "创建图片",
    tryon: "换装",
    pose_variation: "姿势",
    ecommerce_detail: "详情页",
    garment_3d: "3D",
    free_create: "自由创作",
  };
  return labels[module];
}

const ComposerAction: FC = () => {
  const aui = useAui();
  const { uiContext, updateUiContext } = useAgentV2GenerationSettings();
  const attachmentStatus = useComposerAttachmentStatus();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const [openMenu, setOpenMenu] = useState<ComposerToolbarMenu | null>(null);
  const sendDisabled =
    attachmentStatus.uploading > 0 || attachmentStatus.failed > 0;
  const sendTooltip =
    attachmentStatus.failed > 0
      ? "请先移除上传失败的图片"
      : attachmentStatus.uploading > 0
        ? "图片准备中"
        : "发送";

  const toggleMenu = useCallback((menu: ComposerToolbarMenu) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  }, []);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  useEffect(() => {
    if (isRunning) setOpenMenu(null);
  }, [isRunning]);

  const setComposerPrompt = useCallback(
    (prompt: string) => {
      aui.composer().setText(prompt);
      closeMenu();
      requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus();
      });
    },
    [aui, closeMenu],
  );

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-1.5">
        <ComposerToolsMenu
          open={openMenu === "tools"}
          onClose={closeMenu}
          onSetPrompt={setComposerPrompt}
          onSelectApp={(appModule, prompt) => {
            updateUiContext({ appModule, mode: appModule === "image_analysis" ? uiContext.mode : "agent" });
            setComposerPrompt(prompt);
          }}
        />
        <ToolbarButton
          ariaLabel="打开上传和工具菜单"
          active={openMenu === "tools"}
          onClick={() => toggleMenu("tools")}
          icon={SparklesIcon}
        />
        <button
          type="button"
          aria-pressed={uiContext.mode === "agent"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleMenu("agent")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-400/45 bg-sky-400/10 px-2.5 text-sky-600 text-sm transition-colors hover:bg-sky-400/15 dark:text-sky-300"
        >
          {uiContext.mode === "agent" ? (
            <BotIcon className="size-3.5" />
          ) : (
            <MessageCircleIcon className="size-3.5" />
          )}
          {uiContext.mode === "agent" ? "代理" : "聊天"}
        </button>
        <ComposerAgentMenu
          open={openMenu === "agent"}
          mode={uiContext.mode}
          onSelect={(mode) => {
            updateUiContext({ mode });
            closeMenu();
          }}
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleMenu("apps")}
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <Grid2X2Icon className="size-3.5" />
          {getAppModuleLabel(uiContext.appModule)}
          <ChevronDownIcon className="size-3.5" />
        </button>
        <ComposerAppsMenu
          open={openMenu === "apps"}
          selectedModule={uiContext.appModule}
          onSelect={(appModule, prompt) => {
            updateUiContext({ appModule, mode: appModule === "image_analysis" ? uiContext.mode : "agent" });
            setComposerPrompt(prompt);
          }}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggleMenu("speed")}
          className="hidden h-8 items-center gap-1 rounded-full px-2.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
          aria-label={`模型速度：${uiContext.speed}`}
        >
          {uiContext.speed}
          <ChevronDownIcon className="size-3.5" />
        </button>
        <ComposerSpeedMenu
          open={openMenu === "speed"}
          speed={uiContext.speed}
          onSelect={(nextSpeed) => {
            updateUiContext({ speed: nextSpeed });
            closeMenu();
          }}
        />
        <TooltipIconButton
          tooltip="语音输入"
          side="bottom"
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MicIcon className="size-4" />
        </TooltipIconButton>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send
            render={
              <TooltipIconButton
                tooltip={sendTooltip}
                side="bottom"
                type="button"
                variant="default"
                size="icon"
                className="aui-composer-send size-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
                aria-label="发送"
                disabled={sendDisabled}
              />
            }
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel
            render={
              <Button
                type="button"
                variant="default"
                size="icon"
                className="aui-composer-cancel size-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
                aria-label="停止生成"
              />
            }
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

type ComposerToolbarMenu = "tools" | "agent" | "apps" | "speed";

const ToolbarButton: FC<{
  ariaLabel: string;
  active?: boolean;
  icon: ElementType;
  onClick: () => void;
}> = ({ ariaLabel, active, icon: Icon, onClick }) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
};

const ComposerFloatingMenu: FC<{
  open: boolean;
  align?: "left" | "right";
  children: ReactNode;
}> = ({ open, align = "left", children }) => {
  if (!open) return null;

  return (
    <div
      data-no-composer-focus="true"
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "absolute bottom-12 z-50 w-72 overflow-hidden rounded-2xl border border-white/10 bg-[#303030] p-1 text-sm text-white shadow-2xl",
        align === "left" ? "left-0" : "right-0",
      )}
    >
      {children}
    </div>
  );
};

const ComposerToolsMenu: FC<{
  open: boolean;
  onClose: () => void;
  onSetPrompt: (prompt: string) => void;
  onSelectApp: (module: AgentV2AppModule, prompt: string) => void;
}> = ({ open, onClose, onSetPrompt, onSelectApp }) => {
  return (
    <ComposerFloatingMenu open={open}>
      <ComposerPrimitive.AddAttachment
        render={
          <ComposerMenuButton
            icon={PaperclipIcon}
            title="添加照片和文件"
            onClick={onClose}
          />
        }
      />
      <ComposerMenuButton
        icon={FileClockIcon}
        title="近期文件"
        muted
        suffix={<ChevronRightIcon className="size-4" />}
        onClick={() => undefined}
      />
      <div className="my-1 h-px bg-white/10" />
      <ComposerMenuButton
        icon={ImagePlusIcon}
        title="创建图片"
        onClick={() => onSelectApp("image_create", "帮我创建一张商业可用的图片，先根据目标给我方案。")}
      />
      <ComposerMenuButton
        icon={BrainIcon}
        title="深度研究"
        onClick={() => onSetPrompt("请先做深度分析，拆解目标、约束、素材关系和执行步骤。")}
      />
      <ComposerMenuButton
        icon={GlobeIcon}
        title="网页搜索"
        onClick={() => onSetPrompt("请联网搜索相关资料后再回答，并标明关键信息来源。")}
      />
      <ComposerMenuButton
        icon={MoreHorizontalIcon}
        title="更多"
        muted
        suffix={<ChevronRightIcon className="size-4" />}
        onClick={() => undefined}
      />
    </ComposerFloatingMenu>
  );
};

const ComposerAgentMenu: FC<{
  open: boolean;
  mode: AgentV2Mode;
  onSelect: (mode: AgentV2Mode) => void;
}> = ({ open, mode, onSelect }) => {
  return (
    <ComposerFloatingMenu open={open}>
      <ComposerMenuButton
        icon={BotIcon}
        title="代理模式"
        description="理解图片、规划任务、必要时生成确认卡"
        selected={mode === "agent"}
        onClick={() => onSelect("agent")}
      />
      <ComposerMenuButton
        icon={MessageCircleIcon}
        title="聊天模式"
        description="像普通 GPT 一样直接问答，不主动创建任务"
        selected={mode === "chat"}
        onClick={() => onSelect("chat")}
      />
    </ComposerFloatingMenu>
  );
};

const ComposerAppsMenu: FC<{
  open: boolean;
  selectedModule: AgentV2AppModule;
  onSelect: (module: AgentV2AppModule, prompt: string) => void;
}> = ({ open, selectedModule, onSelect }) => {
  return (
    <ComposerFloatingMenu open={open}>
      <ComposerMenuButton
        icon={LightbulbIcon}
        title="图片分析"
        description="先识别内容、关系和可做方向"
        selected={selectedModule === "image_analysis"}
        onClick={() =>
          onSelect("image_analysis", "先分析我上传的图片，判断每张图的角色、关系和适合做的视觉任务。")
        }
      />
      <ComposerMenuButton
        icon={ShirtIcon}
        title="服装换装"
        description="人物图与服装图组合"
        selected={selectedModule === "tryon"}
        onClick={() =>
          onSelect("tryon", "帮我把服装图穿到人物图上，保持人物身份、服装结构、比例和材质准确。")
        }
      />
      <ComposerMenuButton
        icon={WandSparklesIcon}
        title="姿势裂变"
        description="多姿势、单张或拼图输出"
        selected={selectedModule === "pose_variation"}
        onClick={() =>
          onSelect("pose_variation", "基于人物图生成自然可信的姿势变化；如果生成多张，请每张单独出图。")
        }
      />
      <ComposerMenuButton
        icon={ShoppingBagIcon}
        title="电商详情页"
        description="商品卖点、版式、分镜规划"
        selected={selectedModule === "ecommerce_detail"}
        onClick={() =>
          onSelect("ecommerce_detail", "基于这些图片生成一套淘宝/天猫详情页素材，先分析商品卖点、版式结构和所需分镜。")
        }
      />
      <ComposerMenuButton
        icon={Layers3Icon}
        title="3D 展示"
        description="服装 3D 展示可行性分析"
        selected={selectedModule === "garment_3d"}
        onClick={() =>
          onSelect("garment_3d", "先分析这些素材是否适合做 3D 展示，并给我可执行的 3D 生成方案。")
        }
      />
      <ComposerMenuButton
        icon={PaletteIcon}
        title="自由创作"
        description="按目标自由生成商业视觉"
        selected={selectedModule === "free_create"}
        onClick={() =>
          onSelect("free_create", "根据我的目标自由设计一张商业可用的图片，先给我确认方案。")
        }
      />
    </ComposerFloatingMenu>
  );
};

const ComposerSpeedMenu: FC<{
  open: boolean;
  speed: AgentV2Speed;
  onSelect: (speed: AgentV2Speed) => void;
}> = ({ open, speed, onSelect }) => {
  return (
    <ComposerFloatingMenu open={open} align="right">
      <ComposerMenuButton
        icon={SparklesIcon}
        title="Instant"
        description="更快回复，适合普通聊天"
        selected={speed === "Instant"}
        onClick={() => onSelect("Instant")}
      />
      <ComposerMenuButton
        icon={SearchIcon}
        title="Balanced"
        description="默认质量，适合图片理解和方案"
        selected={speed === "Balanced"}
        onClick={() => onSelect("Balanced")}
      />
      <ComposerMenuButton
        icon={BrainIcon}
        title="Deep"
        description="更谨慎规划，适合复杂工作流"
        selected={speed === "Deep"}
        onClick={() => onSelect("Deep")}
      />
    </ComposerFloatingMenu>
  );
};

const ComposerMenuButton: FC<{
  icon: ElementType;
  title: string;
  description?: string;
  muted?: boolean;
  selected?: boolean;
  suffix?: ReactNode;
  onClick: () => void;
}> = ({ icon: Icon, title, description, muted, selected, suffix, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/10",
        muted && "text-white/75",
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-white/90">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs text-white/55">
            {description}
          </span>
        ) : null}
      </span>
      {selected ? <CheckIcon className="size-4 shrink-0 text-sky-300" /> : suffix}
    </button>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantAvatar: FC = () => {
  return (
    <Avatar size="sm" className="mt-1">
      <AvatarFallback className="bg-foreground text-background">
        <WandSparklesIcon className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  );
};

const UserAvatar: FC = () => {
  return (
    <Avatar size="sm" className="mt-1">
      <AvatarFallback className="bg-muted text-foreground">
        <UserIcon className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  );
};

const AssistantThinkingFallback: FC = () => {
  return <AgentThinkingLine />;
};

const AssistantMessage: FC = () => {
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  const hasVisibleParts = useAuiState((s) =>
    s.message.parts.some((part) => shouldRenderAssistantPart(part)),
  );
  const actionBarHeight = "-mb-[1.875rem] min-h-[1.875rem] pt-1.5";

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 relative flex w-full items-start gap-3 px-2 animate-in duration-150"
    >
      <AssistantAvatar />
      <div data-slot="aui_assistant-message-body" className="min-w-0 flex-1">
        <div
          data-slot="aui_assistant-message-content"
          className="wrap-break-word text-sm leading-7 text-foreground dark:text-zinc-100"
        >
          {isRunning && !hasVisibleParts ? <AssistantThinkingFallback /> : null}
          <MessagePrimitive.GroupedParts
            groupBy={(part) => {
              if (part.type === "reasoning")
                return ["group-reasoning", "group-reasoning"];
              if (part.type === "tool-call" && shouldRenderToolProcessPanel(part))
                return ["group-chainOfThought", "group-tool"];
              return null;
            }}
          >
            {({ part, children }) => {
              switch (part.type) {
                case "group-reasoning":
                  return (
                    <ReasoningRoot defaultOpen={part.status.type === "running"}>
                      <ReasoningTrigger active={part.status.type === "running"} />
                      <ReasoningContent aria-busy={part.status.type === "running"}>
                        <ReasoningText>{children}</ReasoningText>
                      </ReasoningContent>
                    </ReasoningRoot>
                  );
                case "group-chainOfThought":
                  return <div data-slot="aui_chain-of-thought">{children}</div>;
                case "group-tool":
                  return (
                    <ToolGroupRoot variant="muted">
                      <ToolGroupTrigger
                        count={part.indices.length}
                        active={part.status.type === "running"}
                      />
                      <ToolGroupContent>{children}</ToolGroupContent>
                    </ToolGroupRoot>
                  );
                case "text":
                  return <MarkdownText />;
                case "reasoning":
                  return <MarkdownText />;
                case "tool-call":
                  if (isQuietAgentTool(part)) return null;
                  return part.toolUI ?? <ToolFallback {...part} />;
                case "data":
                  return part.dataRendererUI;
                default:
                  return null;
              }
            }}
          </MessagePrimitive.GroupedParts>
          <MessageError />
        </div>

        <div
          data-slot="aui_assistant-message-footer"
          className={cn("flex items-center", actionBarHeight)}
        >
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ms-1 flex gap-1 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="复制" />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload
        render={<TooltipIconButton tooltip="重新生成" />}
      >
        <RefreshCwIcon />
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.FeedbackPositive
        render={
          <TooltipIconButton
            tooltip="有帮助"
            className="data-[submitted=true]:bg-emerald-50 data-[submitted=true]:text-emerald-600"
          />
        }
      >
        <ThumbsUpIcon />
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative
        render={
          <TooltipIconButton
            tooltip="不满意"
            className="data-[submitted=true]:bg-rose-50 data-[submitted=true]:text-rose-600"
          />
        }
      >
        <ThumbsDownIcon />
      </ActionBarPrimitive.FeedbackNegative>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger
          render={
            <TooltipIconButton
              tooltip="更多"
              className="data-[state=open]:bg-accent"
            />
          }
        >
          <MoreHorizontalIcon />
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown
            render={
              <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground" />
            }
          >
            <DownloadIcon className="size-4" />
            导出 Markdown
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  const text = useAuiState((s) =>
    readMessageText([
      ...(Array.isArray(s.message.content) ? s.message.content : []),
      ...(Array.isArray(s.message.parts) ? s.message.parts : []),
    ]),
  );

  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 flex w-full flex-col gap-2 px-2 animate-in duration-150"
      data-role="user"
    >
      <div className="flex w-full items-start justify-end gap-3">
        <div className="min-w-0 max-w-[min(85%,36rem)]">
          <UserMessageAttachments />

          <div className="aui-user-message-content-wrapper relative mt-2 min-w-0">
            <div className="aui-user-message-content wrap-break-word peer rounded-2xl bg-muted px-4 py-2.5 text-sm leading-6 text-foreground empty:hidden dark:bg-[#303030] dark:text-white">
              {text ? (
                <p className="whitespace-pre-wrap">{text}</p>
              ) : (
                <MessagePrimitive.Parts />
              )}
            </div>
            <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
              <UserActionBar />
            </div>
          </div>
        </div>
        <UserAvatar />
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="self-end pe-11"
      />
    </MessagePrimitive.Root>
  );
};

function readMessageText(content: readonly unknown[]) {
  const chunks = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (
        ("type" in part) &&
        (part.type === "text" || part.type === "input-text") &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return part.text;
      }
      return "";
    })
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(chunks)).join("\n\n").trim();
}

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit
        render={
          <TooltipIconButton
            tooltip="编辑"
            className="aui-user-action-edit p-4"
          />
        }
      >
        <PencilIcon />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root ms-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel
            render={<Button variant="ghost" size="sm" />}
          >
            取消
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" />}>
            更新
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root -ms-2 me-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous
        render={<TooltipIconButton tooltip="上一条" />}
      >
        <ChevronLeftIcon />
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next
        render={<TooltipIconButton tooltip="下一条" />}
      >
        <ChevronRightIcon />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
