"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, CheckCircle2, CircleDashed, Clock3,
  FolderOpen, History, ImageIcon, Loader2, MessageSquarePlus, PanelLeftClose,
  PanelLeftOpen, Play, Plus, RotateCcw, ScanFace, ShoppingBag, Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTaskQueueGeneration } from "@/components/studio/useTaskQueueGeneration";
import { useStudioAuth } from "@/components/studio/useStudioAuth";
import { useResourcePicker, assetUrls, type ResourceAsset } from "@/features/resource-library";
import { uploadLocalResources } from "@/features/resource-library/api";
import { buildAgentGenerationIdempotencyKey } from "@/lib/agent-generation-idempotency";
import type { CreativeAgentTurnDecision, CreativeConversationClient, CreativeMessageClient } from "@/lib/creative-conversations";
import type { CreativeRunClient } from "@/lib/creative-runs.server";
import {
  AgentComposerControls,
  BUILTIN_AGENT_SKILLS,
  DEFAULT_AGENT_PREFERENCES,
  type AgentCapability,
  type AgentCreationMode,
  type AgentGenerationPreferences,
  type AgentModelOption,
  type AgentSkill,
  type SkillReferenceRole,
} from "./AgentComposerControls";
import { AgentSkillWorkspace, type SkillRoleAssignments, type SkillRunMode } from "./AgentSkillWorkspace";
type GenerationStatus = { status?: string; status_group?: string; result_urls?: string[]; error?: string | null; progress?: number };

const QUICK_STARTS = [
  { label: "电商视觉导演（官方）", prompt: "为这件商品制作干净、可信、有购买欲的电商主视觉，突出产品质感和核心卖点。", icon: ShoppingBag, tone: "text-sky-500" },
  { label: "自然美颜精修", prompt: "在保持人物身份和真实皮肤纹理的前提下自然精修，修正光影与肤色，不要塑料感。", icon: Sparkles, tone: "text-violet-500" },
  { label: "角色设定", prompt: "创建一套统一的商业角色视觉设定，包含稳定外观、服装、色彩和摄影语言。", icon: ScanFace, tone: "text-fuchsia-500" },
  { label: "电商商品展示短片", prompt: "基于参考商品图制作一条突出核心卖点、镜头运动自然的电商展示短片。", icon: Play, tone: "text-red-500" },
  { label: "图片动效", prompt: "为参考图片添加自然、克制的镜头运动和局部动态，保持主体与画面结构稳定。", icon: ImageIcon, tone: "text-emerald-500" },
] as const;

/** VOZEB-PRO /create home, wired to the host account, credits and queue APIs. */
export function AgentExperience() {
  const materialInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const { openResourcePicker } = useResourcePicker();
  const { authChecked, isAuthenticated, userId, setCredits } = useStudioAuth();
  const taskQueue = useTaskQueueGeneration({ module: "creativeAgent", title: "Agent 创作", defaultExpectedCount: 1, applyPath: "/agent" });
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<ResourceAsset[]>([]);
  const [creationMode, setCreationMode] = useState<AgentCreationMode>("agent");
  const [preferredCapability, setPreferredCapability] = useState<AgentCapability>("image");
  const [availableModels, setAvailableModels] = useState<AgentModelOption[]>([]);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [smartPlanning, setSmartPlanning] = useState(true);
  const [preferences, setPreferences] = useState<AgentGenerationPreferences>(DEFAULT_AGENT_PREFERENCES);
  const [skills, setSkills] = useState<AgentSkill[]>(BUILTIN_AGENT_SKILLS);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [skillRunMode, setSkillRunMode] = useState<SkillRunMode>("quick");
  const [skillRoleAssignments, setSkillRoleAssignments] = useState<SkillRoleAssignments>({});
  const [optimizing, setOptimizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [focusedReferenceId, setFocusedReferenceId] = useState("");
  const [replaceReferenceId, setReplaceReferenceId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [conversations, setConversations] = useState<CreativeConversationClient[]>([]);
  const [messages, setMessages] = useState<CreativeMessageClient[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [runs, setRuns] = useState<CreativeRunClient[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/creative-runs?limit=16", { cache: "no-store" });
      if (response.status === 401) { setRuns([]); return; }
      const payload = await response.json().catch(() => ({})) as { runs?: CreativeRunClient[]; error?: string };
      if (!response.ok && response.status >= 500) {
        setRuns(await loadLegacyGenerationRuns());
        return;
      }
      if (!response.ok) throw new Error(payload.error || "创作记录加载失败");
      setRuns(Array.isArray(payload.runs) ? payload.runs : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创作记录加载失败");
    } finally { setLoadingRuns(false); }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/creative-agent/conversations?limit=30", { cache: "no-store" });
      if (response.status === 401) { setConversations([]); return; }
      const payload = await response.json().catch(() => ({})) as { conversations?: CreativeConversationClient[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "对话记录加载失败");
      setConversations(Array.isArray(payload.conversations) ? payload.conversations : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "对话记录加载失败");
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) { setMessages([]); return; }
    setLoadingMessages(true);
    try {
      const response = await fetch(`/api/creative-agent/conversations/${encodeURIComponent(conversationId)}/messages`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { messages?: CreativeMessageClient[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "对话消息加载失败");
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "对话消息加载失败");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const ensureConversation = useCallback(async () => {
    if (activeConversationId) return activeConversationId;
    const response = await fetch("/api/creative-agent/conversations", { method: "POST" });
    const payload = await response.json().catch(() => ({})) as { conversation?: CreativeConversationClient; error?: string };
    if (!response.ok || !payload.conversation?.id) throw new Error(payload.error || "对话创建失败");
    setActiveConversationId(payload.conversation.id);
    setConversations((current) => [payload.conversation!, ...current.filter((item) => item.id !== payload.conversation!.id)]);
    return payload.conversation.id;
  }, [activeConversationId]);

  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search).get("prompt");
    if (!incoming) return;
    setPrompt(incoming.slice(0, 4000));
    window.history.replaceState({}, "", "/agent");
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated) { setLoadingRuns(false); setLoadingConversations(false); return; }
    void Promise.all([loadRuns(), loadConversations()]);
  }, [authChecked, isAuthenticated, loadConversations, loadRuns]);

  useEffect(() => {
    const stored = window.localStorage.getItem("vozeb-agent-sidebar-collapsed");
    setSidebarCollapsed(stored === null ? window.matchMedia("(max-width: 767px)").matches : stored === "true");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/model-catalog", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})),
      fetch("/api/video/options", { cache: "no-store" }).then((response) => response.json()).catch(() => ({})),
    ]).then(([imagePayload, videoPayload]) => {
      if (cancelled) return;
      setAvailableModels([
        ...normalizeImageModels(imagePayload),
        ...normalizeVideoModels(videoPayload),
      ]);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const storageKey = `creative-agent-skills:${userId}`;
    let local: AgentSkill[] = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as unknown;
      if (Array.isArray(stored)) {
        local = stored.filter(isAgentSkill).map((skill) => ({ ...skill, userCreated: true }));
        setSkills([...BUILTIN_AGENT_SKILLS, ...local]);
      }
    } catch {
      setSkills(BUILTIN_AGENT_SKILLS);
    }
    let cancelled = false;
    void fetch("/api/creative-skills?includeDisabled=1", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({})) as { skills?: unknown };
      if (cancelled || !Array.isArray(payload.skills)) return;
      const remote = payload.skills.filter(isAgentSkill);
      const merged = Array.from(new Map([...BUILTIN_AGENT_SKILLS, ...local, ...remote].map((skill) => [skill.id, skill])).values());
      setSkills(merged);
      window.localStorage.setItem(storageKey, JSON.stringify(merged.filter((skill) => skill.userCreated || skill.scope === "user")));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);

  const addCustomSkill = async (skill: AgentSkill) => {
    const response = await fetch("/api/creative-skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skill),
    });
    const payload = await response.json().catch(() => ({})) as { skill?: AgentSkill; error?: string };
    if (!response.ok || !payload.skill) throw new Error(payload.error || "Skill 保存失败");
    const saved = payload.skill;
    setSkills((current) => {
      const next = [...current.filter((item) => item.id !== saved.id), saved];
      if (userId) window.localStorage.setItem(`creative-agent-skills:${userId}`, JSON.stringify(next.filter((item) => item.userCreated)));
      return next;
    });
    toast.success("Skill 已创建并应用");
  };

  const updateCustomSkill = async (skill: AgentSkill) => {
    const response = await fetch(`/api/creative-skills/${encodeURIComponent(skill.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(skill),
    });
    const payload = await response.json().catch(() => ({})) as { skill?: AgentSkill; error?: string };
    if (!response.ok || !payload.skill) throw new Error(payload.error || "Skill 更新失败");
    setSkills((current) => current.map((item) => item.id === skill.id ? payload.skill! : item));
    toast.success("Skill 已更新并生成新版本");
  };

  const deleteCustomSkill = async (skillId: string) => {
    const response = await fetch(`/api/creative-skills/${encodeURIComponent(skillId)}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || "Skill 删除失败");
    }
    setSkills((current) => current.filter((item) => item.id !== skillId));
    if (selectedSkillId === skillId) selectSkill("");
    toast.success("Skill 已删除");
  };

  const importGithubSkill = async (url: string, path?: string) => {
    const response = await fetch("/api/creative-skills/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, path, save: true }),
    });
    const payload = await response.json().catch(() => ({})) as { skill?: AgentSkill; candidates?: Array<{ path: string; name: string }>; error?: string };
    if (!response.ok) throw new Error(payload.error || "GitHub Skill 导入失败");
    if (!payload.skill) return { candidates: payload.candidates || [] };
    setSkills((current) => [...current.filter((item) => item.id !== payload.skill!.id), payload.skill!]);
    toast.success("Skill 已固定到 GitHub commit，启用后即可使用");
    return { skill: payload.skill, candidates: [] };
  };

  const toggleModel = (id: string) => {
    const nextModel = availableModels.find((item) => item.id === id);
    if (!nextModel) return;
    if (creationMode !== "agent") setCreationMode(nextModel.capability);
    setSelectedModelIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      const hasDifferentCapability = current.some((itemId) => availableModels.find((item) => item.id === itemId)?.capability !== nextModel.capability);
      if (hasDifferentCapability) {
        setPreferredCapability(nextModel.capability);
        setSmartPlanning(false);
        return [id];
      }
      if (current.length >= 6) { toast.info("最多同时选择 6 个模型"); return current; }
      setPreferredCapability(nextModel.capability);
      setSmartPlanning(false);
      return [...current, id];
    });
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem("vozeb-agent-sidebar-collapsed", String(next));
      return next;
    });
  };

  const selectReferences = async () => {
    if (references.length >= 10) {
      toast.info("最多选择 10 张图");
      return;
    }
    const selected = await openResourcePicker({
      title: "选择资源", role: "Agent 参考图", selectionMode: "multiple", maxCount: 10,
      existingCount: references.length, mediaTypes: ["image"],
      excludedAssetIds: references.map((item) => item.id), excludedUrls: references.map((item) => item.url),
    });
    if (selected?.length) setReferences((current) => [...current, ...selected].slice(0, 10));
  };

  const selectSkill = (id: string) => {
    if (selectedSkillId !== id) {
      setSkillRunMode("quick");
      setSkillRoleAssignments({});
    }
    setSelectedSkillId(id);
    if (id) window.requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const selectRoleReferences = async (role: SkillReferenceRole) => {
    const current = skillRoleAssignments[role.id] || [];
    if (current.length >= role.maxCount) {
      toast.info(`${role.label}最多添加 ${role.maxCount} 项`);
      return;
    }
    const selected = await openResourcePicker({
      title: `选择${role.label}`,
      role: `${selectedSkill?.name || "Agent Skill"} · ${role.label}`,
      selectionMode: role.maxCount === 1 ? "single" : "multiple",
      maxCount: role.maxCount,
      existingCount: current.length,
      mediaTypes: role.mediaTypes || ["image"],
      excludedAssetIds: current.map((item) => item.id),
      excludedUrls: current.map((item) => item.url),
    });
    if (!selected?.length) return;
    setSkillRoleAssignments((assignments) => ({
      ...assignments,
      [role.id]: uniqueResourceAssets([...(assignments[role.id] || []), ...selected]).slice(0, role.maxCount),
    }));
  };

  const assignExistingToRole = (role: SkillReferenceRole, assetId: string) => {
    const asset = references.find((item) => item.id === assetId);
    if (!asset) return;
    setSkillRoleAssignments((assignments) => {
      const current = assignments[role.id] || [];
      if (current.some((item) => item.id === assetId)) return assignments;
      if (current.length >= role.maxCount) { toast.info(`${role.label}最多添加 ${role.maxCount} 项`); return assignments; }
      return { ...assignments, [role.id]: [...current, asset] };
    });
  };

  const openLocalUpload = (referenceId = "") => {
    if (!referenceId && references.length >= 10) {
      toast.info("最多选择 10 张图");
      return;
    }
    setReplaceReferenceId(referenceId);
    materialInputRef.current?.click();
  };

  const uploadMaterials = async (files: File[]) => {
    if (!files.length || uploadingMaterial) return;
    if (!isAuthenticated) {
      window.location.href = `/login?next=${encodeURIComponent("/agent")}`;
      return;
    }
    const remaining = replaceReferenceId ? 1 : Math.max(0, 10 - references.length);
    const accepted = files.filter((file) => file.type.startsWith("image/")).slice(0, remaining);
    if (!accepted.length) {
      toast.error(remaining ? "当前 Agent 仅支持添加图片素材" : "最多选择 10 张图");
      return;
    }
    setUploadingMaterial(true);
    try {
      const result = await uploadLocalResources(accepted);
      if (result.assets.length) {
        if (replaceReferenceId) {
          const replacement = result.assets[0];
          setReferences((current) => current.map((item) => item.id === replaceReferenceId ? replacement : item));
          setFocusedReferenceId(replacement.id);
          toast.success("素材已替换");
        } else {
          setReferences((current) => [...current, ...result.assets].slice(0, 10));
          toast.success(`已添加 ${result.assets.length} 个素材`);
        }
      }
      if (result.errors.length) toast.error(`${result.errors.length} 个素材上传失败`);
    } finally {
      setUploadingMaterial(false);
      setReplaceReferenceId("");
      if (materialInputRef.current) materialInputRef.current.value = "";
    }
  };

  const optimize = async () => {
    if (!prompt.trim() || optimizing) return;
    const revision = prompt;
    setOptimizing(true);
    try {
      const response = await fetch("/api/optimize-prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: revision }) });
      const payload = await response.json().catch(() => ({})) as { optimized?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "提示词优化失败");
      if (prompt === revision && payload.optimized) setPrompt(payload.optimized);
      toast.success("提示词已优化，可继续修改");
    } catch (error) { toast.error(error instanceof Error ? error.message : "提示词优化失败"); }
    finally { setOptimizing(false); }
  };

  const submit = async () => {
    const intent = prompt.trim();
    if (!intent || submitting) return;
    if (!isAuthenticated) { window.location.href = `/login?next=${encodeURIComponent("/agent")}`; return; }
    const roleReferences = Object.values(skillRoleAssignments).flat();
    const generationReferences = uniqueResourceAssets([...references, ...roleReferences]);
    const requiredRole = selectedSkill?.referenceRoles?.find((role) => role.required && !(skillRoleAssignments[role.id] || []).length);
    if (requiredRole) {
      toast.error(`请先添加${requiredRole.label}`);
      return;
    }
    if (selectedSkill?.requiresReference && !generationReferences.length) {
      toast.error(`Skill「${selectedSkill.name}」需要先添加参考素材`);
      return;
    }
    setSubmitting(true);
    let optimisticTaskId = "";
    try {
      const conversationId = await ensureConversation();
      const plannerResponse = await fetch(`/api/creative-agent/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: intent,
          creationMode,
          preferredCapability,
          hasReferences: generationReferences.length > 0,
          hasSkill: Boolean(selectedSkillId),
        }),
      });
      const plannerPayload = await plannerResponse.json().catch(() => ({})) as {
        decision?: CreativeAgentTurnDecision;
        messages?: CreativeMessageClient[];
        error?: string;
      };
      if (!plannerResponse.ok || !plannerPayload.decision) throw new Error(plannerPayload.error || "Agent 未能完成本轮规划");
      if (Array.isArray(plannerPayload.messages)) setMessages(plannerPayload.messages);
      setPrompt("");
      await loadConversations();
      if (plannerPayload.decision.kind === "conversation") return;

      const capability: AgentCapability = plannerPayload.decision.capability || preferredCapability;
      if (capability === "video" && !generationReferences.length) throw new Error("视频生成需要至少添加 1 张参考图");
      if (capability === "video" && preferences.video.referenceMode === "first_last" && generationReferences.length < 2) {
        throw new Error("首尾帧视频需要添加 2 张参考图");
      }
      const selectedModels = availableModels.filter((item) => selectedModelIds.includes(item.id));
      const modelsForRun = selectedModels.filter((item) => item.capability === capability);
      if (!modelsForRun.length) {
        const defaultModel = availableModels.find((item) => item.capability === capability);
        if (defaultModel) modelsForRun.push(defaultModel);
      }
      if (!modelsForRun.length) throw new Error(`当前没有可用的${capability === "video" ? "视频" : "图片"}模型`);
      const outputCount = capability === "video" ? preferences.video.count : preferences.image.count;
      const expectedCount = outputCount * modelsForRun.length;
      const optimistic = taskQueue.startTask({ inputThumbnails: assetUrls(generationReferences), expectedCount });
      optimisticTaskId = optimistic.id;
      const clientRequestId = crypto.randomUUID();
      const runResponse = await fetch("/api/creative-runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent, mode: capability, clientRequestId, conversationId,
          aspectRatio: capability === "video" ? preferences.video.aspectRatio : preferences.image.aspectRatio,
          imageSize: preferences.image.imageSize,
          selectedModelIds, selectedSkillIds: selectedSkillId ? [selectedSkillId] : [], generationPreferences: preferences,
          skillRunMode,
          skillReferenceRoleAssetIds: Object.fromEntries(Object.entries(skillRoleAssignments).map(([roleId, assets]) => [roleId, assets.map((asset) => asset.id)])),
        }),
      });
      const runPayload = await runResponse.json().catch(() => ({})) as { run?: { id?: string; execution?: { generationPreferences?: AgentGenerationPreferences } }; error?: string };
      const runId = runResponse.ok && runPayload.run?.id ? runPayload.run.id : undefined;
      if (!runId) throw new Error(runPayload.error || "Agent Run 创建失败");
      const runPreferences = isAgentGenerationPreferences(runPayload.run?.execution?.generationPreferences)
        ? runPayload.run.execution.generationPreferences
        : preferences;
      const resolvedOutputCount = capability === "video" ? runPreferences.video.count : runPreferences.image.count;
      const generationEndpoint = capability === "video" && preferences.video.referenceMode === "first_last"
        ? "/api/video/first-last-frame"
        : capability === "video" ? "/api/video/image-to-video" : "/api/general-image";
      const imageAspectRatio = resolveImageAspectRatio(runPreferences.image);
      const imageSize = resolveImageSize(runPreferences.image);
      const referenceUrls = assetUrls(generationReferences);
      const generations: Array<{ id: string; endpoint: string }> = [];
      for (const [index, currentModel] of modelsForRun.entries()) {
        const generationBody = capability === "video"
          ? {
              ...(preferences.video.referenceMode === "first_last"
                ? { firstFrameUrl: referenceUrls[0], lastFrameUrl: referenceUrls[1] }
                : { imageUrl: referenceUrls[0] }),
              prompt: intent,
              provider: currentModel.provider || "seedance",
              modelMode: currentModel.videoMode || "fast",
              resolution: currentModel.resolutions?.includes(runPreferences.video.resolution) ? runPreferences.video.resolution : currentModel.resolutions?.[0] || runPreferences.video.resolution,
              duration: runPreferences.video.seconds,
              genCount: runPreferences.video.count,
              aspectRatio: runPreferences.video.aspectRatio,
              audioMode: runPreferences.video.generateAudio ? "generate" : "off",
              ...(runId ? { creative_run_id: runId, creative_step_key: `video-${index + 1}`, creative_step_title: `${selectedSkill?.name || "Agent 视频生成"} · ${currentModel.name}` } : {}),
            }
          : {
              mode: generationReferences.length ? "image-to-image" : "text-to-image", prompt: intent, user_prompt: intent,
              reference_urls: referenceUrls, ai_model: currentModel.id, aspect_ratio: imageAspectRatio, image_size: imageSize,
              gen_count: runPreferences.image.count,
              ...(runId ? { creative_run_id: runId, creative_step_key: `image-${index + 1}`, creative_step_title: `${selectedSkill?.name || "Agent 主视觉"} · ${currentModel.name}` } : {}),
            };
        const generationResponse = await fetch(generationEndpoint, {
          method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": buildAgentGenerationIdempotencyKey(clientRequestId, index) },
          body: JSON.stringify(generationBody),
        });
        const generation = await generationResponse.json().catch(() => ({})) as { generation_id?: string; credits_remaining?: number; error?: string };
        if (!generationResponse.ok || !generation.generation_id) throw new Error(generation.error || `${currentModel.name} 提交失败`);
        if (typeof generation.credits_remaining === "number") setCredits(generation.credits_remaining);
        generations.push({ id: generation.generation_id, endpoint: generationEndpoint });
        if (index === 0) {
          taskQueue.replaceWithServerTask(optimistic.id, { id: generation.generation_id, status: "processing", statusGroup: "running", progress: 18, expectedCount: resolvedOutputCount, inputThumbnails: referenceUrls });
        } else {
          taskQueue.upsertTask({ id: generation.generation_id, status: "processing", statusGroup: "running", progress: 18, expectedCount: resolvedOutputCount, inputThumbnails: referenceUrls });
        }
      }
      setReferences([]); setFocusedReferenceId(""); setSkillRoleAssignments({});
      await loadRuns();
      await Promise.all(generations.map((generation) => pollGeneration(generation.id, {
        onProgress: (status) => taskQueue.markRunning(generation.id, { progress: status.progress ?? 40 }),
        onComplete: (urls) => taskQueue.markCompleted(generation.id, { resultCount: urls.length, resultThumbnails: urls }),
      }, generation.endpoint).catch((error) => {
        const message = error instanceof Error ? error.message : "生成任务失败";
        taskQueue.markFailed(generation.id, message);
        throw error;
      })));
      await loadRuns();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent 创作失败";
      if (optimisticTaskId) taskQueue.markFailed(optimisticTaskId, message);
      toast.error(message);
    } finally { setSubmitting(false); }
  };

  const latestResults = useMemo(() => runs.flatMap((run) => run.steps.flatMap((step) => step.resultUrls.map((url) => ({ url, run, step })))).slice(0, 8), [runs]);
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const newConversation = () => {
    setActiveConversationId("");
    setMessages([]);
    setPrompt("");
    setReferences([]);
    setFocusedReferenceId("");
    setSelectedSkillId("");
    setSkillRunMode("quick");
    setSkillRoleAssignments({});
  };

  return (
    <main className="studio-workbench relative min-h-[calc(100vh-64px)] text-[#20242a] dark:text-[#f3f5f7]">
      <div className="relative flex h-full min-h-[620px] overflow-hidden bg-white dark:bg-[#111316]">
        <ConversationSidebar
          conversations={conversations}
          loading={loadingConversations}
          collapsed={sidebarCollapsed}
          activeConversationId={activeConversationId}
          onToggle={toggleSidebar}
          onNew={newConversation}
          onSelect={(conversation) => {
            setActiveConversationId(conversation.id);
            setPrompt("");
            void loadMessages(conversation.id);
            if (window.matchMedia("(max-width: 767px)").matches) setSidebarCollapsed(true);
          }}
        />
        <div className="relative flex min-w-0 flex-1 flex-col max-md:pl-[68px]">
          <header className="flex h-14 shrink-0 items-center border-b border-[#eceef1] px-5 dark:border-[#292d33]">
            <h2 className="truncate text-sm font-semibold">{activeConversation?.title || "新对话"}</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className={`mx-auto flex min-h-full w-full min-w-0 max-w-[1240px] flex-col items-center px-2.5 pb-8 sm:px-8 ${messages.length || loadingMessages ? "pt-6 sm:pt-8" : "pt-10 sm:pt-14 lg:pt-[8vh]"}`}>
              {!messages.length && !loadingMessages ? <div className="text-center"><h1 className="text-[23px] font-semibold leading-tight sm:text-[31px]">Pixel Diffusion 创作 Agent</h1><p className="mt-2 text-sm text-[#8b949f] dark:text-[#7f8996]">从一个想法开始</p></div> : null}
              {loadingMessages ? <div className="flex min-h-48 items-center gap-2 text-sm text-[#8b949f]"><Loader2 className="size-4 animate-spin" />正在载入对话...</div> : null}
              {messages.length ? <ConversationThread messages={messages} /> : null}
              <div ref={composerRef} className={`w-full max-w-[1080px] scroll-mt-4 ${messages.length ? "mt-6" : "mt-5 sm:mt-8"}`}>
                <div className="overflow-visible rounded-[22px] border border-[#e2e6ea] bg-white p-3 shadow-[0_10px_32px_rgba(32,36,42,0.06)] dark:border-[#30363e] dark:bg-[#181b20] dark:shadow-black/25 sm:p-4">
                  {selectedSkill ? (
                    <AgentSkillWorkspace
                      skill={selectedSkill}
                      mode={skillRunMode}
                      assignments={skillRoleAssignments}
                      unassignedAssets={references}
                      onModeChange={setSkillRunMode}
                      onRemoveSkill={() => selectSkill("")}
                      onAddToRole={(role) => void selectRoleReferences(role)}
                      onAssignExisting={assignExistingToRole}
                      onRemoveFromRole={(roleId, assetId) => setSkillRoleAssignments((assignments) => ({ ...assignments, [roleId]: (assignments[roleId] || []).filter((asset) => asset.id !== assetId) }))}
                    />
                  ) : null}
                  <div className={`min-w-0 ${references.length ? "block" : "flex gap-3"}`}>
                    {references.length ? (
                      <ReferenceStrip
                        references={references}
                        focusedId={focusedReferenceId}
                        onFocus={setFocusedReferenceId}
                        onEdit={openLocalUpload}
                        onRemove={(id) => {
                          setReferences((items) => items.filter((item) => item.id !== id));
                          if (focusedReferenceId === id) setFocusedReferenceId("");
                        }}
                      >
                        <MaterialAddControl compact uploading={uploadingMaterial} atLimit={references.length >= 10} onLocal={() => openLocalUpload()} onLibrary={() => void selectReferences()} />
                      </ReferenceStrip>
                    ) : (
                      <MaterialAddControl uploading={uploadingMaterial} atLimit={false} onLocal={() => openLocalUpload()} onLibrary={() => void selectReferences()} />
                    )}
                    <div className="min-w-0 flex-1">
                      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入你的创作想法、脚本或画面要求" aria-label="输入你的创作想法、脚本或画面要求" maxLength={4000} className={`block w-full resize-y border-0 bg-transparent px-1 py-1 text-[15px] leading-7 text-[#20242a] outline-none placeholder:text-[#b3bac4] dark:text-[#f3f5f7] sm:px-2 ${references.length ? "min-h-[96px] pt-3" : "min-h-[112px]"}`} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit(); }} />
                    </div>
                  </div>
                  <div className="flex min-w-0 items-end gap-2 overflow-visible px-0.5 pb-0.5 pt-2">
                    <AgentComposerControls
                      mode={creationMode}
                      preferredCapability={preferredCapability}
                      models={availableModels}
                      selectedModelIds={selectedModelIds}
                      smartPlanning={smartPlanning}
                      preferences={preferences}
                      skills={skills}
                      selectedSkillId={selectedSkillId}
                      optimizing={optimizing}
                      canOptimize={Boolean(prompt.trim())}
                      onModeChange={(value) => { setCreationMode(value); if (value !== "agent") setPreferredCapability(value); }}
                      onPreferredCapabilityChange={setPreferredCapability}
                      onToggleModel={toggleModel}
                      onSmartPlanningChange={(value) => { setSmartPlanning(value); if (value) setSelectedModelIds([]); }}
                      onPreferencesChange={setPreferences}
                      onReference={() => void selectReferences()}
                      onSkillChange={selectSkill}
                      onCreateSkill={addCustomSkill}
                      onUpdateSkill={updateCustomSkill}
                      onDeleteSkill={deleteCustomSkill}
                      onImportSkill={importGithubSkill}
                      onOptimize={() => void optimize()}
                    />
                    <button type="button" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#20242a] text-white transition hover:bg-[#343b44] disabled:bg-[#e2e5e8] disabled:text-[#aeb5bd] dark:bg-[#f1f3f5] dark:text-[#20242a] dark:hover:bg-white dark:disabled:bg-[#30353c] dark:disabled:text-[#68717d]" disabled={!prompt.trim() || submitting} onClick={() => void submit()} aria-label="发送">{submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</button>
                  </div>
                </div>
              </div>
              {!messages.length ? <QuickStarts onPrompt={setPrompt} onSkill={selectSkill} onMode={(mode) => { setCreationMode(mode); if (mode !== "agent") setPreferredCapability(mode); }} /> : null}
              <RecentResults runs={runs} results={latestResults} loading={loadingRuns} onReload={loadRuns} />
            </div>
          </div>
        </div>
        <input ref={materialInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/avif" className="hidden" onChange={(event) => void uploadMaterials(Array.from(event.target.files || []))} />
      </div>
    </main>
  );
}

function ConversationSidebar({ conversations, loading, collapsed, activeConversationId, onToggle, onNew, onSelect }: { conversations: CreativeConversationClient[]; loading: boolean; collapsed: boolean; activeConversationId: string; onToggle: () => void; onNew: () => void; onSelect: (conversation: CreativeConversationClient) => void }) {
  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col border-r border-[#e8ebef] bg-[#f7f8fb] transition-[width] duration-200 dark:border-[#292d33] dark:bg-[#15181c] max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 ${collapsed ? "w-[68px]" : "w-[286px] max-md:shadow-2xl"}`}
      data-collapsed={collapsed || undefined}
      aria-label="对话侧边栏"
    >
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? "justify-center" : "justify-end px-3"}`}>
        <button type="button" className="grid size-9 place-items-center rounded-lg text-[#66717e] transition hover:bg-white hover:text-[#20242a] dark:text-[#a3acb7] dark:hover:bg-[#242930] dark:hover:text-white" onClick={onToggle} aria-label={collapsed ? "展开对话侧边栏" : "收起对话侧边栏"} title={collapsed ? "展开侧边栏" : "收起侧边栏"}>
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        </button>
      </div>

      <div className={`px-2 ${collapsed ? "flex justify-center" : ""}`}>
        <button type="button" className={`flex h-11 items-center rounded-xl text-sm font-semibold text-[#343b44] transition hover:bg-white dark:text-[#dce1e7] dark:hover:bg-[#242930] ${collapsed ? "w-11 justify-center" : "w-full gap-2.5 px-3"}`} onClick={onNew} aria-label="开启新对话" title="开启新对话">
          <MessageSquarePlus className="size-[18px] shrink-0" />
          {!collapsed ? <span>开启新对话</span> : null}
        </button>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-hidden">
        {!collapsed ? <h2 className="px-4 pb-2 text-[13px] font-semibold text-[#20242a] dark:text-[#f3f5f7]">对话历史</h2> : null}
        {!collapsed ? <div className="h-full overflow-y-auto px-2.5 pb-4">
          {loading ? <div className="grid h-12 place-items-center text-[#9aa2ad]"><Loader2 className="size-4 animate-spin" /></div> : null}
          {!loading && !conversations.length ? <p className="py-6 text-center text-xs text-[#9aa2ad]">暂无对话记录</p> : null}
          {conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <button key={conversation.id} type="button" className={`mb-1 flex min-h-12 w-full items-center rounded-xl px-3 py-2 text-left transition ${active ? "bg-white text-[#20242a] shadow-[inset_0_0_0_1px_rgba(224,228,236,0.9)] dark:bg-[#242930] dark:text-white dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]" : "text-[#657080] hover:bg-white/80 hover:text-[#20242a] dark:text-[#9ca6b2] dark:hover:bg-[#20242a] dark:hover:text-white"}`} onClick={() => onSelect(conversation)} title={conversation.title}>
                <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{conversation.title || "新对话"}</span><span className="mt-1 block text-[10px] text-[#9aa2ad]">{formatDate(conversation.lastMessageAt)}</span></span>
              </button>
            );
          })}
        </div> : null}
      </div>

      <div className="shrink-0 border-t border-[#e8ebef] p-2 dark:border-[#292d33]">
        <SidebarLink href="/history" collapsed={collapsed} label="生成记录" icon={<History className="size-[18px]" />} />
        <SidebarLink href="/resource-library" collapsed={collapsed} label="资源仓库" icon={<FolderOpen className="size-[18px]" />} />
      </div>
    </aside>
  );
}

function ConversationThread({ messages }: { messages: CreativeMessageClient[] }) {
  return (
    <section className="w-full max-w-[1080px] space-y-5" aria-label="对话消息">
      {messages.map((message) => message.role === "user" ? (
        <article key={message.id} className="flex justify-end">
          <div className="max-w-[min(78%,720px)] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-[#20242a] px-4 py-3 text-[14px] leading-6 text-white shadow-sm dark:bg-[#f1f3f5] dark:text-[#20242a]">
            {message.content}
          </div>
        </article>
      ) : (
        <article key={message.id} className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-[#edf1ff] text-[#5f63dc] dark:bg-[#262b3c] dark:text-[#aeb4ff]" aria-hidden="true"><Sparkles className="size-4" /></span>
          <div className="max-w-[min(82%,760px)] whitespace-pre-wrap rounded-[18px] rounded-tl-md border border-[#e5e8ec] bg-white px-4 py-3 text-[14px] leading-6 text-[#343b44] shadow-[0_4px_18px_rgba(32,36,42,0.04)] dark:border-[#30363e] dark:bg-[#181b20] dark:text-[#e1e5ea]">
            {message.content}
          </div>
        </article>
      ))}
    </section>
  );
}

function SidebarLink({ href, collapsed, label, icon }: { href: string; collapsed: boolean; label: string; icon: React.ReactNode }) {
  return <Link href={href} className={`flex h-11 items-center rounded-xl text-sm font-medium text-[#657080] transition hover:bg-white hover:text-[#20242a] dark:text-[#9ca6b2] dark:hover:bg-[#242930] dark:hover:text-white ${collapsed ? "justify-center" : "gap-2.5 px-3"}`} aria-label={label} title={label}>{icon}{!collapsed ? <span>{label}</span> : null}</Link>;
}

function MaterialAddControl({ compact = false, uploading, atLimit, onLocal, onLibrary }: { compact?: boolean; uploading: boolean; atLimit: boolean; onLocal: () => void; onLibrary: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggle = () => {
    if (atLimit) {
      toast.info("最多选择 10 张图");
      return;
    }
    setOpen((value) => !value);
  };

  return (
    <div ref={rootRef} className="relative z-30 shrink-0">
      <button
        type="button"
        className={`grid shrink-0 place-items-center border border-[#e2e6ea] bg-[#f7f8fa] text-[#596470] transition hover:border-[#cbd2d9] hover:bg-[#f0f2f5] hover:text-[#20242a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6965e8]/35 dark:border-[#30363e] dark:bg-[#20242a] dark:text-[#aab2bd] dark:hover:bg-[#292f37] dark:hover:text-white ${compact ? "h-24 w-[78px] rounded-[11px]" : "h-[112px] w-[72px] rounded-xl sm:w-[88px]"}`}
        disabled={uploading}
        onClick={toggle}
        aria-label="添加素材"
        aria-expanded={open}
      >
        {uploading ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-6" />}
      </button>
      {open ? (
        <div className={`absolute z-50 w-[154px] rounded-[20px] border border-[#e0e3e8] bg-white p-2 shadow-[0_16px_40px_rgba(32,36,42,0.16)] dark:border-[#343a43] dark:bg-[#20242a] ${compact ? "left-0 top-full mt-2" : "left-0 top-full mt-2 sm:left-full sm:top-0 sm:ml-2 sm:mt-0"}`} role="menu" aria-label="素材来源">
          <button type="button" className="flex h-12 w-full items-center justify-center rounded-[14px] bg-[#f2f3f6] text-[15px] font-medium text-[#30353c] transition hover:bg-[#e9ebef] dark:bg-[#2a2f36] dark:text-white dark:hover:bg-[#333941]" onClick={() => { setOpen(false); onLocal(); }} role="menuitem">本地上传</button>
          <button type="button" className="mt-1 flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-medium text-[#30353c] transition hover:bg-[#f5f6f8] dark:text-white dark:hover:bg-[#2a2f36]" onClick={() => { setOpen(false); onLibrary(); }} role="menuitem">资源仓库</button>
        </div>
      ) : null}
    </div>
  );
}

function ReferenceStrip({ references, focusedId, onFocus, onRemove, onEdit, children }: { references: ResourceAsset[]; focusedId: string; onFocus: (id: string) => void; onRemove: (id: string) => void; onEdit: (id: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-2 px-1 pb-2" aria-label="已添加素材">
      {references.map((asset, index) => {
        const focused = asset.id === focusedId;
        const controls = focused ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
        return (
          <div key={asset.id} className={`group relative h-24 w-[78px] shrink-0 overflow-hidden rounded-[11px] border bg-[#eef1f4] transition ${focused ? "border-[#5d62d8] ring-2 ring-[#716cf0]/35" : "border-[#dde1e6] hover:border-[#aeb5c0] dark:border-[#343a43]"}`}>
            <button type="button" className="absolute inset-0 z-0 focus:outline-none" onClick={() => onFocus(asset.id)} aria-label={`聚焦图 ${index + 1}`}>
              <Image src={asset.previewUrl || asset.url} alt={asset.title || `图 ${index + 1}`} fill unoptimized sizes="78px" className="object-cover" />
            </button>
            <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-white/90 px-1 py-0.5 text-[10px] font-medium text-[#68717d] shadow-sm">图{index + 1}</span>
            <button type="button" className={`absolute right-0 top-0 z-20 grid size-6 place-items-center rounded-bl-lg bg-[#69717d] text-white transition ${controls}`} onClick={() => onRemove(asset.id)} aria-label={`移除图 ${index + 1}`}><X className="size-3.5" /></button>
            <button type="button" className={`absolute bottom-1.5 left-1/2 z-20 h-7 -translate-x-1/2 rounded-md bg-[#3b3e43]/92 px-3 text-xs font-medium text-white shadow-sm transition hover:bg-[#20242a] ${controls}`} onClick={() => onEdit(asset.id)}>编辑</button>
          </div>
        );
      })}
      {children}
    </div>
  );
}

function QuickStarts({ onPrompt, onSkill, onMode }: { onPrompt: (value: string) => void; onSkill: (id: string) => void; onMode: (mode: AgentCreationMode) => void }) {
  const skillByLabel: Record<string, string> = { "电商视觉导演（官方）": "ecommerce-image", "自然美颜精修": "natural-beauty", "角色设定": "character-design", "电商商品展示短片": "ecommerce-video", "图片动效": "image-motion" };
  return <div className="mt-2 flex w-full min-w-0 max-w-[1080px] flex-wrap justify-center gap-1.5 sm:mt-3 sm:gap-2">{QUICK_STARTS.map((item) => { const Icon = item.icon; const className = "inline-flex h-9 items-center gap-2 rounded-full border border-[#e3e7eb] bg-white px-3 text-sm font-medium text-[#343b44] transition hover:border-[#cfd6dd] hover:bg-[#f7f8fa] dark:border-[#343a42] dark:bg-[#181b20] dark:text-[#dce1e7] dark:hover:border-[#4a525d] dark:hover:bg-[#20242a]"; return <button key={item.label} type="button" className={className} onClick={() => { onPrompt(item.prompt); onSkill(skillByLabel[item.label] || ""); if (item.label === "电商商品展示短片" || item.label === "图片动效") onMode("video"); }}><Icon className={`size-4 ${item.tone}`} />{item.label}</button>; })}</div>;
}

function RecentResults({ runs, results, loading, onReload }: { runs: CreativeRunClient[]; results: Array<{ url: string; run: CreativeRunClient; step: CreativeRunClient["steps"][number] }>; loading: boolean; onReload: () => Promise<void> }) {
  return <section className="mt-8 w-full sm:mt-12" aria-labelledby="agent-recent-heading"><div className="flex items-end justify-between gap-3 border-b border-[#e8ebef] pb-3 dark:border-[#292d33]"><div><h2 id="agent-recent-heading" className="text-[15px] font-semibold">最近生成</h2><p className="mt-1 text-xs text-[#8b949f] dark:text-[#7f8996]">点击图片或视频可直接查看</p></div><div className="flex items-center gap-2"><Link href="/resource-library" className="text-xs text-[#697381] hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:text-white">查看素材库 ↗</Link><button type="button" className="grid size-8 place-items-center rounded-md text-[#697381] hover:bg-[#f2f4f6] dark:text-[#9aa3af] dark:hover:bg-[#242930]" onClick={() => void onReload()} aria-label="刷新"><RotateCcw className="size-3.5" /></button></div></div>{loading ? <div className="flex min-h-32 items-center justify-center gap-2 text-xs text-[#9aa2ad]"><Loader2 className="size-4 animate-spin" />正在加载创作记录...</div> : results.length ? <div className="grid grid-cols-2 gap-2 pt-3 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">{results.map(({ url, run, step }) => <article key={`${run.id}-${step.id}-${url}`} className="overflow-hidden rounded-lg border border-[#e2e7eb] bg-white dark:border-[#2b3037] dark:bg-[#181b20]"><div className="relative aspect-[4/3] bg-[#eef1f4] dark:bg-[#252a31]">{isVideoUrl(url) ? <video src={url} controls playsInline className="h-full w-full object-cover" /> : <Image src={url} alt={run.summary || "Agent 生成结果"} fill unoptimized sizes="(max-width:640px) 50vw,240px" className="object-cover" />}</div><div className="flex items-center justify-between gap-2 px-2.5 py-2"><strong className="truncate text-xs font-medium">{run.summary || "Agent 创作"}</strong><CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" /></div></article>)}</div> : runs.length ? <div className="divide-y divide-[#edf0f2] pt-2 dark:divide-[#292d33]">{runs.slice(0, 8).map((run) => <AgentRunRow key={run.id} run={run} />)}</div> : <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-center text-xs text-[#9aa2ad]"><CircleDashed className="size-5" /><span>完成一次图片或视频生成后，结果会出现在这里</span></div>}</section>;
}

function AgentRunRow({ run }: { run: CreativeRunClient }) {
  const active = ["draft", "queued", "running"].includes(run.status);
  return <article className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 py-3"><span className="grid size-8 place-items-center rounded-lg bg-[#f1f3f5] text-[#697381] dark:bg-[#252a31] dark:text-[#aab2bd]">{active ? <Loader2 className="size-4 animate-spin" /> : run.status === "completed" ? <CheckCircle2 className="size-4" /> : <CircleDashed className="size-4" />}</span><div className="min-w-0"><strong className="block truncate text-xs font-medium">{run.summary || run.intent}</strong><p className="mt-1 text-[11px] text-[#9aa2ad]">{run.steps.length ? `${run.steps.length} 个执行步骤` : "正在准备执行计划"}</p></div><time className="hidden items-center gap-1 text-[11px] text-[#9aa2ad] sm:flex"><Clock3 className="size-3" />{formatDate(run.createdAt)}</time></article>;
}

async function loadLegacyGenerationRuns(): Promise<CreativeRunClient[]> {
  const response = await fetch("/api/history?limit=16", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { rows?: unknown[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "创作记录加载失败");
  return (Array.isArray(payload.rows) ? payload.rows : []).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const job = row.job_payload && typeof row.job_payload === "object" && !Array.isArray(row.job_payload)
      ? row.job_payload as Record<string, unknown>
      : {};
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) return [];
    const intent = typeof job.userPrompt === "string" && job.userPrompt.trim()
      ? job.userPrompt.trim()
      : typeof job.prompt === "string" && job.prompt.trim()
        ? job.prompt.trim()
        : "图片生成";
    const status = typeof row.status === "string" ? row.status : "queued";
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    const completedAt = typeof row.completed_at === "string" ? row.completed_at : createdAt;
    const resultUrls = Array.isArray(row.result_urls)
      ? row.result_urls.filter((url): url is string => typeof url === "string" && Boolean(url))
      : [];
    const errorMessage = typeof row.error_message === "string" ? row.error_message : null;
    return [{
      id,
      status,
      intent,
      summary: intent.slice(0, 120),
      surface: "agent",
      projectId: null,
      createdAt,
      updatedAt: completedAt,
      errorMessage,
      steps: [{
        id: `legacy:${id}`,
        status,
        title: "Agent 主视觉",
        generationId: id,
        resultUrls,
        errorMessage,
      }],
    } satisfies CreativeRunClient];
  });
}

async function pollGeneration(generationId: string, callbacks: { onProgress: (status: GenerationStatus) => void; onComplete: (urls: string[]) => void }, endpoint = "/api/general-image") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12 * 60_000) {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    const response = await fetch(`${endpoint}?generation_id=${encodeURIComponent(generationId)}`, { cache: "no-store" });
    const status = await response.json().catch(() => ({})) as GenerationStatus;
    if (!response.ok) throw new Error(status.error || "任务状态查询失败");
    callbacks.onProgress(status);
    if (status.status_group === "completed" || status.status === "completed") { const urls = Array.isArray(status.result_urls) ? status.result_urls : []; callbacks.onComplete(urls); return urls; }
    if (status.status_group === "failed" || ["failed", "cancelled", "needs_review"].includes(status.status || "")) throw new Error(status.error || "Agent 生成未完成");
  }
  throw new Error("任务仍在后台执行，可稍后在最近生成中查看");
}

function normalizeImageModels(value: unknown): AgentModelOption[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const catalog = (value as { catalog?: unknown }).catalog;
  if (!Array.isArray(catalog)) return [];
  return catalog.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") return [];
    return [{
      id: row.id,
      name: typeof row.displayName === "string" ? row.displayName : row.id,
      description: typeof row.description === "string" && row.description ? row.description : "图片模型 · 可与其他模型同时选择",
      capability: "image" as const,
    }];
  });
}

function normalizeVideoModels(value: unknown): AgentModelOption[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const providers = (value as { providers?: unknown }).providers;
  if (!Array.isArray(providers)) return [];
  return providers.flatMap((providerValue) => {
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) return [];
    const provider = providerValue as Record<string, unknown>;
    const providerName = provider.provider === "minimax" ? "minimax" : provider.provider === "seedance" ? "seedance" : null;
    if (!providerName || !Array.isArray(provider.modes)) return [];
    const resolutionsByMode = provider.resolutionsByMode && typeof provider.resolutionsByMode === "object" && !Array.isArray(provider.resolutionsByMode) ? provider.resolutionsByMode as Record<string, unknown> : {};
    const durations = Array.isArray(provider.durations) ? provider.durations.flatMap((item) => typeof item === "number" ? [item] : item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).value === "number" ? [(item as Record<string, unknown>).value as number] : []) : [];
    return provider.modes.flatMap((modeValue) => {
      if (!modeValue || typeof modeValue !== "object" || Array.isArray(modeValue)) return [];
      const mode = modeValue as Record<string, unknown>;
      if (!(["mini", "fast", "pro"] as unknown[]).includes(mode.value)) return [];
      const id = `${providerName}:${mode.value}`;
      const resolutionRows = Array.isArray(resolutionsByMode[String(mode.value)]) ? resolutionsByMode[String(mode.value)] as unknown[] : [];
      return [{
        id,
        name: typeof mode.label === "string" ? mode.label : id,
        description: `${providerName === "seedance" ? "Seedance" : "MiniMax"} 视频模型 · 可与其他模型同时生成`,
        capability: "video" as const,
        provider: providerName,
        videoMode: mode.value as "mini" | "fast" | "pro",
        resolutions: resolutionRows.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).value === "string" ? [(item as Record<string, unknown>).value as string] : []),
        durations,
      }];
    });
  });
}

function resolveImageAspectRatio(value: AgentGenerationPreferences["image"]) {
  const width = Number(value.customWidth);
  const height = Number(value.customHeight);
  if (!width || !height) return value.aspectRatio;
  const ratio = width / height;
  const options = ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"];
  return options.reduce((best, item) => {
    const [w, h] = item.split(":").map(Number);
    const [bestW, bestH] = best.split(":").map(Number);
    return Math.abs(w / h - ratio) < Math.abs(bestW / bestH - ratio) ? item : best;
  }, "1:1");
}

function resolveImageSize(value: AgentGenerationPreferences["image"]): "1K" | "2K" | "4K" {
  const maxEdge = Math.max(Number(value.customWidth) || 0, Number(value.customHeight) || 0);
  if (maxEdge >= 3000) return "4K";
  if (maxEdge >= 1800) return "2K";
  return value.imageSize;
}

function isAgentSkill(value: unknown): value is AgentSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<AgentSkill>;
  return typeof row.id === "string" && typeof row.name === "string" && typeof row.description === "string" && typeof row.instructions === "string" && Array.isArray(row.keywords) && Array.isArray(row.capabilities);
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)(?:$|\?)/i.test(url) || /\/video\//i.test(url);
}

function uniqueResourceAssets(assets: ResourceAsset[]) {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    const key = asset.id || asset.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isAgentGenerationPreferences(value: unknown): value is AgentGenerationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<AgentGenerationPreferences>;
  return Boolean(row.image && typeof row.image === "object" && row.video && typeof row.video === "object" && row.audio && typeof row.audio === "object");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "刚刚" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
