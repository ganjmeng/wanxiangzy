"use client";

import {
  type FC,
  type PropsWithChildren,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { XIcon, PlusIcon, FileText } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
} from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import {
  AGENT_ATTACHMENT_ROLE_OPTIONS,
  getAttachmentRole,
  setAttachmentRole,
  subscribeAttachmentRoles,
  type AgentAttachmentRole,
} from "@/components/agent-v2/attachment-role-store";
import { cn } from "@/lib/utils";

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]
        ?.image;
      if (!src) return {};
      return { src };
    }),
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt="Attachment preview"
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full object-contain",
        isLoaded
          ? "aui-attachment-preview-image-loaded"
          : "aui-attachment-preview-image-loading invisible",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();

  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        className="aui-attachment-preview-trigger cursor-pointer transition-colors hover:bg-accent/50"
      >
        {children}
      </DialogTrigger>
      <DialogContent className="aui-attachment-preview-dialog-content p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:bg-foreground/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0! [&_svg]:text-background [&>button]:hover:[&_svg]:text-destructive">
        <DialogTitle className="aui-sr-only sr-only">
          Image Attachment Preview
        </DialogTitle>
        <div className="aui-attachment-preview relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden bg-background">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      <AvatarImage
        src={src}
        alt="Attachment preview"
        className="aui-attachment-tile-image object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon size-8 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  );
};

const AttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";

  const isImage = useAuiState((s) => s.attachment.type === "image");
  const attachmentId = useAuiState((s) => s.attachment.id);
  const attachmentStatus = useAuiState((s) => s.attachment.status);
  const persistedRole = useAuiState((s) => {
    const content = Array.isArray(s.attachment.content)
      ? s.attachment.content
      : [];
    const imagePart = content.find(
      (part) =>
        part.type === "image" &&
        typeof (part as { role?: unknown }).role === "string",
    );
    return coerceAttachmentRole(
      (imagePart as { role?: unknown } | undefined)?.role,
    );
  });
  const typeLabel = useAuiState((s) => {
    const type = s.attachment.type;
    switch (type) {
      case "image":
        return "Image";
      case "document":
        return "Document";
      case "file":
        return "File";
      default:
        return type;
    }
  });

  return (
    <Tooltip>
      <AttachmentPrimitive.Root
        className={cn(
          "aui-attachment-root relative",
          isImage && "aui-attachment-root-composer only:*:first:size-24",
        )}
      >
        <AttachmentPreviewDialog>
          <TooltipTrigger render={<div className="aui-attachment-tile size-14 cursor-pointer overflow-hidden rounded-[calc(var(--composer-radius)-var(--composer-padding))] border bg-muted transition-opacity hover:opacity-75 dark:border-white/10 dark:bg-zinc-800" role="button" tabIndex={0} aria-label={`${typeLabel} attachment`} />}><AttachmentThumb /></TooltipTrigger>
        </AttachmentPreviewDialog>
        <AttachmentStatusOverlay status={attachmentStatus} />
        {isImage ? (
          <AttachmentRoleSelect
            attachmentId={attachmentId}
            editable={isComposer}
            persistedRole={persistedRole}
          />
        ) : null}
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

const AttachmentStatusOverlay: FC<{ status: unknown }> = ({ status }) => {
  if (!isRecord(status)) return null;

  if (status.type === "running") {
    const progress =
      typeof status.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(status.progress * 100)))
        : 0;
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/45 text-white backdrop-blur-[1px]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        <span className="text-[10px] font-semibold leading-none">
          上传中{progress ? ` ${progress}%` : ""}
        </span>
      </div>
    );
  }

  if (status.type === "incomplete") {
    return (
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-red-950/70 px-1 text-center text-[10px] font-semibold leading-4 text-white">
        上传失败
      </div>
    );
  }

  return null;
};

const AttachmentRoleSelect: FC<{
  attachmentId?: string;
  editable: boolean;
  persistedRole?: AgentAttachmentRole;
}> = ({ attachmentId, editable, persistedRole }) => {
  const draftRole = useAttachmentRole(attachmentId);
  const role = editable ? draftRole : persistedRole || draftRole;
  const current =
    AGENT_ATTACHMENT_ROLE_OPTIONS.find((item) => item.value === role) ||
    AGENT_ATTACHMENT_ROLE_OPTIONS[0];

  if (!editable) {
    return (
      <span className="pointer-events-none absolute left-1 top-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm">
        {current.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={`图片标签：${current.description}。点击切换标签`}
      aria-label={`图片标签：${current.label}，点击切换`}
      onClick={(event) => {
        event.stopPropagation();
        setAttachmentRole(attachmentId, getNextAttachmentRole(role));
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute left-1 top-1 z-20 rounded-md border border-white/20 bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm backdrop-blur transition-colors hover:bg-foreground focus:bg-foreground"
    >
      {current.label}
    </button>
  );
};

function useAttachmentRole(attachmentId?: string) {
  return useSyncExternalStore(
    subscribeAttachmentRoles,
    () => getAttachmentRole(attachmentId),
    () => getAttachmentRole(attachmentId),
  );
}

function coerceAttachmentRole(value: unknown): AgentAttachmentRole | undefined {
  if (typeof value !== "string") return undefined;
  return AGENT_ATTACHMENT_ROLE_OPTIONS.some((option) => option.value === value)
    ? (value as AgentAttachmentRole)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getNextAttachmentRole(role: AgentAttachmentRole) {
  const index = AGENT_ATTACHMENT_ROLE_OPTIONS.findIndex((option) => option.value === role);
  const next = AGENT_ATTACHMENT_ROLE_OPTIONS[(index + 1) % AGENT_ATTACHMENT_ROLE_OPTIONS.length];
  return next?.value || "auto";
}

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove render={<TooltipIconButton tooltip="移除附件" className="aui-attachment-tile-remove absolute end-1.5 top-1.5 size-3.5 rounded-full bg-white text-muted-foreground opacity-100 shadow-sm hover:bg-white! [&_svg]:text-black hover:[&_svg]:text-destructive" side="top" />}><XIcon className="aui-attachment-remove-icon size-3 dark:stroke-[2.5px]" /></AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-1.5">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  return (
    <ComposerPrimitive.AddAttachment render={<TooltipIconButton tooltip="上传图片" side="bottom" variant="ghost" size="icon" className="aui-composer-add-attachment size-8 rounded-full p-1 font-semibold text-xs hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30" aria-label="上传图片" />}><PlusIcon className="aui-attachment-add-icon size-5 stroke-[1.5px]" /></ComposerPrimitive.AddAttachment>
  );
};
