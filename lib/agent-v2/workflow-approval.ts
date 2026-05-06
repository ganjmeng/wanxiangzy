import type { AgentBrainDecision } from "@/lib/agent/brain/types";
import type {
  WorkflowCostEstimate,
  WorkflowInputImage,
  WorkflowPlan,
  WorkflowRecord,
  WorkflowStepRecord,
} from "@/lib/agent/workflow/types";

export type AgentV2WorkflowApprovalInput = {
  kind: "workflow_approval";
  title: string;
  goal: string;
  module: string;
  moduleLabel: string;
  confidence: number;
  estimatedCredits: number | null;
  workflowId?: string;
  workflowStatus?: WorkflowRecord["status"];
  plan?: WorkflowPlan;
  workflowSteps?: WorkflowStepRecord[];
  costEstimate?: WorkflowCostEstimate;
  inputImages?: WorkflowInputImage[];
  steps: Array<{
    title: string;
    description: string;
  }>;
  risks: string[];
  nextAction: "confirm_required";
  canExecute: false;
  reason: string;
};

const MODULE_LABELS: Record<string, string> = {
  general: "通用生成",
  tryon: "服装换装",
  grass: "电商种草图",
  garment_3d: "3D 展示",
  model: "专属模特",
  model_background: "换模特/换背景",
  pose: "姿势裂变",
};

export function shouldCreateWorkflowApproval(decision: AgentBrainDecision): boolean {
  return decision.action === "generate" && Boolean(decision.module);
}

export function buildWorkflowApprovalInput(
  decision: AgentBrainDecision,
  userText: string,
): AgentV2WorkflowApprovalInput {
  const module = decision.module || "general";
  const moduleLabel = MODULE_LABELS[module] || module;
  const steps = buildSteps(module, decision);
  const risks = buildRisks(module, decision);

  return {
    kind: "workflow_approval",
    title: `${moduleLabel}确认`,
    goal: userText.trim() || decision.reply,
    module,
    moduleLabel,
    confidence: Number(decision.confidence.toFixed(2)),
    estimatedCredits: estimateCredits(module, decision),
    steps,
    risks,
    nextAction: "confirm_required",
    canExecute: false,
    reason: "这是确认预览，不会扣积分，也不会开始生成。确认后才会执行任务。",
  };
}

export function buildWorkflowApprovalInputFromWorkflow({
  workflow,
  plan,
  steps,
  costEstimate,
  inputImages,
}: {
  workflow: WorkflowRecord;
  plan: WorkflowPlan;
  steps: WorkflowStepRecord[];
  costEstimate: WorkflowCostEstimate;
  inputImages: WorkflowInputImage[];
}): AgentV2WorkflowApprovalInput {
  const module = mapWorkflowIntentToModule(workflow.intent || plan.intent);
  const moduleLabel = MODULE_LABELS[module] || workflow.intent || "工作流";

  return {
    kind: "workflow_approval",
    title: `${moduleLabel}确认`,
    goal: workflow.summary || plan.summary,
    module,
    moduleLabel,
    confidence: Number((plan.confidence || 0.7).toFixed(2)),
    estimatedCredits: costEstimate.total,
    workflowId: workflow.id,
    workflowStatus: workflow.status,
    plan,
    workflowSteps: steps,
    costEstimate,
    inputImages,
    steps: plan.steps.map((step) => ({
      title: step.title,
      description:
        typeof step.input?.prompt === "string"
          ? String(step.input.prompt).slice(0, 160)
          : step.riskNotes?.[0] || step.type,
    })),
    risks: Array.from(new Set([
      ...plan.assumptions,
      ...plan.steps.flatMap((step) => step.riskNotes || []),
    ])).slice(0, 4),
    nextAction: "confirm_required",
    canExecute: false,
    reason: "已生成生产工作流草案。只有点击确认后才会扣积分并开始执行。",
  };
}

function mapWorkflowIntentToModule(intent?: string | null): AgentV2WorkflowApprovalInput["module"] {
  const normalized = String(intent || "").toLowerCase();
  if (normalized.includes("tryon") || normalized.includes("try_on")) return "tryon";
  if (normalized.includes("pose")) return "pose";
  if (normalized.includes("3d")) return "garment_3d";
  if (normalized.includes("background")) return "model_background";
  if (normalized.includes("model")) return "model";
  if (normalized.includes("grass") || normalized.includes("commerce")) return "grass";
  return "general";
}

function buildSteps(module: string, decision: AgentBrainDecision): AgentV2WorkflowApprovalInput["steps"] {
  if (module === "tryon") {
    return [
      { title: "确认图片角色", description: "区分服装图、人物图和参考图，避免把来源图混用。" },
      { title: "生成换装结果", description: "保持服装结构、颜色、材质和人物姿态自然可信。" },
      { title: "质量复核", description: "检查服装还原、脸部一致性、手指和身体比例。" },
    ];
  }

  if (module === "pose") {
    return [
      { title: "读取主体信息", description: "确认人物、服装、参考姿势和输出方式。" },
      { title: "设计姿势变化", description: "生成自然可信、彼此不同、适合商业展示的姿势。" },
      { title: "质量复核", description: "检查比例、关节、手指、脸部一致性和服装稳定性。" },
    ];
  }

  if (module === "garment_3d") {
    return [
      { title: "分析商品主体", description: "确认服装或商品是否适合做立体展示。" },
      { title: "生成 3D 展示图", description: "创建具有空间感和材质表现的商品展示视觉。" },
      { title: "质量复核", description: "检查主体完整性、材质、角度和背景干净度。" },
    ];
  }

  if (decision.visualTaskPlan?.taskType === "commerce_detail") {
    return [
      { title: "理解商品和用途", description: "确认这是电商详情页任务，不误判成种草图或普通海报。" },
      { title: "规划详情页版式", description: "组织首屏、卖点、细节、参数和场景展示区域。" },
      { title: "生成并校验", description: "检查文字层级、分区完整性和商品一致性。" },
    ];
  }

  return [
    { title: "理解创作目标", description: "整理主体、风格、比例、输出数量和关键约束。" },
    { title: "生成视觉结果", description: "选择合适的文生图、图生图或组合工作流执行。" },
    { title: "质量复核", description: "检查数量、可访问性、画面一致性和任务匹配度。" },
  ];
}

function buildRisks(module: string, decision: AgentBrainDecision): string[] {
  const risks: string[] = [];
  if (decision.safety.reasons.length) risks.push(...decision.safety.reasons);
  if (module === "tryon") risks.push("重点检查服装结构、颜色、logo 和面料是否被改变。");
  if (module === "pose") risks.push("重点检查手指、关节、身体比例和脸部一致性。");
  if (module === "garment_3d") risks.push("复杂背景或多人图可能影响主体识别。");
  if (decision.visualTaskPlan?.taskType === "commerce_detail") {
    risks.push("详情页小字和中文排版可能不稳定，生成后需要复核。");
  }
  if (!risks.length) risks.push("生成结果仍受模型稳定性影响，确认后会进入质量检查。");
  return Array.from(new Set(risks)).slice(0, 4);
}

function estimateCredits(module: string, decision: AgentBrainDecision): number | null {
  const count = Number(decision.params.count || decision.params.gen_count || 1);
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(4, Math.floor(count))) : 1;
  if (module === "pose") return 8;
  if (module === "tryon") return 4;
  if (module === "garment_3d") return 3;
  if (decision.visualTaskPlan?.taskType === "commerce_detail") return 4;
  return 3 * safeCount;
}
