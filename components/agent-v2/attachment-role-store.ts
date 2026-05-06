"use client";

export type AgentAttachmentRole =
  | "auto"
  | "person"
  | "clothing"
  | "product"
  | "reference"
  | "face"
  | "background"
  | "source"
  | "style";

const DEFAULT_ROLE: AgentAttachmentRole = "auto";
const roles = new Map<string, AgentAttachmentRole>();
const listeners = new Set<() => void>();

export const AGENT_ATTACHMENT_ROLE_OPTIONS: Array<{
  value: AgentAttachmentRole;
  label: string;
  description: string;
}> = [
  { value: "auto", label: "自动", description: "让 AI 判断" },
  { value: "person", label: "人物", description: "模特/真人" },
  { value: "clothing", label: "服装", description: "衣服/穿搭" },
  { value: "product", label: "商品", description: "商品主体" },
  { value: "reference", label: "参考", description: "姿势/风格参考" },
  { value: "face", label: "脸图", description: "面部参考" },
  { value: "background", label: "背景", description: "场景/背景" },
  { value: "source", label: "原图", description: "保留主体" },
  { value: "style", label: "风格", description: "视觉风格" },
];

export function getAttachmentRole(id: string | undefined): AgentAttachmentRole {
  if (!id) return DEFAULT_ROLE;
  return roles.get(id) || DEFAULT_ROLE;
}

export function setAttachmentRole(id: string | undefined, role: AgentAttachmentRole) {
  if (!id) return;
  roles.set(id, role);
  emit();
}

export function clearAttachmentRole(id: string | undefined) {
  if (!id) return;
  roles.delete(id);
  emit();
}

export function subscribeAttachmentRoles(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}
